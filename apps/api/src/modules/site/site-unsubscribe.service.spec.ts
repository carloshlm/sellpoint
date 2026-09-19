import { generateKeyPairSync } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { JwtKeyProvider } from "../../infrastructure/crypto/jwt-key.provider";
import { SiteUnsubscribeService } from "./site-unsubscribe.service";

const AHORA = new Date("2026-10-05T12:00:00.000Z");
const LEAD_ID = "11111111-2222-3333-4444-555555555555";

// Una llave RSA de verdad, generada UNA vez para todo el archivo: el secreto
// del HMAC se deriva de la llave privada del JWT (la que ya exige el env), y
// un doble que devolviera una cadena no probaría esa derivación.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function buildService(overrides?: { lead?: Record<string, unknown> | null }) {
  const prisma = {
    siteLead: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides?.lead === undefined
            ? { id: LEAD_ID, email: "ana@example.com", locale: "es", unsubscribedAt: null }
            : overrides.lead,
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const configService = {
    get: (key: string) => (key === "APP_URL" ? "https://app.example.com" : undefined),
  } as unknown as ConfigService<Env, true>;
  const clock = { now: () => AHORA };
  const jwtKeys = {
    get: () => ({ privateKey, publicKeys: new Map(), activeKid: "kid" }),
  } as unknown as JwtKeyProvider;

  const service = new SiteUnsubscribeService(
    prisma as never,
    configService,
    clock as never,
    jwtKeys,
  );
  return { service, prisma };
}

/**
 * F11-SITE-LEGAL-04 — la baja de los correos comerciales.
 *
 * Todavía no existe un buzón del dominio (`bajas@sellpointy.com` espera al
 * correo, que espera al DNS), así que el `mailto:` que sería lo natural no es
 * posible. En su lugar, un enlace firmado: sin tabla de bajas nueva, sin
 * variable de entorno nueva y sin que el enlace de una persona sirva para dar
 * de baja a otra.
 */
describe("SiteUnsubscribeService — el enlace", () => {
  it("apunta al API detrás del mismo dominio de la aplicación", () => {
    const { service } = buildService();

    const url = service.urlFor(LEAD_ID, "es");

    expect(url.startsWith("https://app.example.com/api/public/unsubscribe?token=")).toBe(true);
  });

  it("el token lleva el id y el idioma, y va FIRMADO", () => {
    const { service } = buildService();

    const token = new URL(service.urlFor(LEAD_ID, "fr")).searchParams.get("token") ?? "";

    const [leadId, locale, firma] = token.split(".");
    expect(leadId).toBe(LEAD_ID);
    expect(locale).toBe("fr");
    expect(firma).toBeTruthy();
  });

  it("dos prospectos distintos tienen firmas distintas: un enlace no da de baja a otro", () => {
    const { service } = buildService();

    const uno = service.urlFor(LEAD_ID, "es");
    const otro = service.urlFor("99999999-2222-3333-4444-555555555555", "es");

    expect(uno).not.toBe(otro);
  });
});

describe("SiteUnsubscribeService — dar de baja", () => {
  function tokenValido(service: SiteUnsubscribeService, locale = "es") {
    return new URL(service.urlFor(LEAD_ID, locale)).searchParams.get("token") as string;
  }

  it("token válido: sella la baja de TODOS los envíos de ese correo y confirma en su idioma", async () => {
    const { service, prisma } = buildService();

    const result = await service.apply(tokenValido(service));

    expect(result.ok).toBe(true);
    expect(prisma.siteLead.updateMany).toHaveBeenCalledWith({
      where: { email: "ana@example.com", unsubscribedAt: null },
      data: { unsubscribedAt: AHORA },
    });
    expect(result.html).toContain("No te escribiremos más");
  });

  it("la página va en el idioma del prospecto: francés de «vous»", async () => {
    const { service } = buildService({
      lead: { id: LEAD_ID, email: "ana@example.com", locale: "fr", unsubscribedAt: null },
    });

    const result = await service.apply(tokenValido(service, "fr"));

    expect(result.html).toContain('lang="fr"');
    expect(result.html).toContain("vous");
  });

  it("el inglés también tiene su página", async () => {
    const { service } = buildService({
      lead: { id: LEAD_ID, email: "ana@example.com", locale: "en", unsubscribedAt: null },
    });

    const result = await service.apply(tokenValido(service, "en"));

    expect(result.html).toContain('lang="en"');
    expect(result.html).toContain("We will not email you again");
  });

  it("dar de baja dos veces confirma igual y no vuelve a escribir", async () => {
    const { service, prisma } = buildService({
      lead: { id: LEAD_ID, email: "ana@example.com", locale: "es", unsubscribedAt: AHORA },
    });

    const result = await service.apply(tokenValido(service));

    expect(result.ok).toBe(true);
    expect(prisma.siteLead.updateMany).not.toHaveBeenCalled();
  });

  it("un prospecto ya purgado a los 24 meses confirma igual: no queda nada de qué darse de baja", async () => {
    const { service, prisma } = buildService({ lead: null });

    const result = await service.apply(tokenValido(service));

    expect(result.ok).toBe(true);
    expect(prisma.siteLead.updateMany).not.toHaveBeenCalled();
  });
});

describe("SiteUnsubscribeService — lo que NO pasa", () => {
  it("sin token: rechaza sin tocar la base", async () => {
    const { service, prisma } = buildService();

    const result = await service.apply(undefined);

    expect(result.ok).toBe(false);
    expect(prisma.siteLead.findUnique).not.toHaveBeenCalled();
  });

  it("token mal formado: rechaza", async () => {
    const { service } = buildService();

    await expect(service.apply("esto-no-es-un-token")).resolves.toMatchObject({ ok: false });
  });

  it("firma alterada: rechaza y NO da de baja a nadie", async () => {
    const { service, prisma } = buildService();

    const result = await service.apply(`${LEAD_ID}.es.firma-inventada`);

    expect(result.ok).toBe(false);
    expect(prisma.siteLead.updateMany).not.toHaveBeenCalled();
  });

  it("id cambiado conservando la firma ajena: rechaza", async () => {
    const { service, prisma } = buildService();
    const token = new URL(service.urlFor(LEAD_ID, "es")).searchParams.get("token") as string;
    const firma = token.split(".")[2];

    const result = await service.apply(`99999999-2222-3333-4444-555555555555.es.${firma}`);

    expect(result.ok).toBe(false);
    expect(prisma.siteLead.updateMany).not.toHaveBeenCalled();
  });

  /**
   * La página de error NO dice si ese prospecto existe, ni repite el correo,
   * ni distingue «token inventado» de «token de alguien que ya no está»: el
   * enlace de baja de un correo comercial no puede convertirse en una forma de
   * averiguar quién nos escribió.
   */
  it("el rechazo no filtra nada: ni el correo, ni si existe", async () => {
    const { service } = buildService();

    const result = await service.apply(`${LEAD_ID}.es.firma-inventada`);

    expect(result.html).not.toContain("ana@example.com");
    expect(result.html).not.toContain(LEAD_ID);
  });
});
