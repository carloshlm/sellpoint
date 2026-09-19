import { Logger } from "@nestjs/common";
import {
  SITE_LEADS_RETENTION_MONTHS,
  SiteLeadsRetentionJob,
  siteLeadsRetentionCutoff,
} from "./site-leads-retention.job";

/**
 * F11-SITE-LEAD-10 — los prospectos se borran solos a los 24 meses.
 *
 * El aviso de privacidad lo PROMETE («después se borran de forma
 * automática»), así que tiene que ser verdad. Acá se fija la lógica pura y el
 * contrato del barrido; las tres situaciones que importan —23 meses se queda,
 * 25 se va, 25 que ya es cliente se queda— se prueban contra la base de
 * verdad en `site-leads-retention.integration.spec.ts`, porque «ya es
 * cliente» se resuelve con una función de Postgres y un mock no probaría nada.
 */
describe("siteLeadsRetentionCutoff (F11-SITE-LEAD-10)", () => {
  it("el plazo son 24 meses, en una constante con nombre", () => {
    expect(SITE_LEADS_RETENTION_MONTHS).toBe(24);
  });

  it("corta exactamente dos años atrás", () => {
    expect(siteLeadsRetentionCutoff(new Date("2026-09-18T20:00:00.000Z")).toISOString()).toBe(
      "2024-09-18T20:00:00.000Z",
    );
  });

  it("un día que no existe dos años atrás no rompe: rueda al siguiente", () => {
    // 29 de febrero de 2028 menos 24 meses cae en un 2026 que no lo tiene.
    expect(siteLeadsRetentionCutoff(new Date("2028-02-29T00:00:00.000Z")).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
});

describe("SiteLeadsRetentionJob (F11-SITE-LEAD-10)", () => {
  let prisma: { $executeRaw: jest.Mock };
  let job: SiteLeadsRetentionJob;

  beforeEach(() => {
    prisma = { $executeRaw: jest.fn().mockResolvedValue(3) };
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    job = new SiteLeadsRetentionJob(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("devuelve cuántos borró", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    await expect(job.run(new Date("2026-09-18T20:00:00.000Z"))).resolves.toEqual({ deleted: 3 });
  });

  /** Se registra CUÁNTOS se borraron, nunca quiénes. */
  it("el log dice el número y la fecha de corte, jamás un correo", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();

    await job.run(new Date("2026-09-18T20:00:00.000Z"));

    const texto = logSpy.mock.calls.flat().join(" ");
    expect(texto).toContain("3");
    expect(texto).toContain("2024-09-18");
    expect(texto).not.toMatch(/@/);
  });

  it("una pasada sin nada que borrar es un cero, no un error", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    prisma.$executeRaw.mockResolvedValue(0);

    await expect(job.run(new Date("2026-09-18T20:00:00.000Z"))).resolves.toEqual({ deleted: 0 });
  });
});
