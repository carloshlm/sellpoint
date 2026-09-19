import { Logger } from "@nestjs/common";
import { SITE_CRON_HOUR, SITE_CRON_TZ, SiteCronRegistrar } from "./site-cron.registrar";

/**
 * F11-SITE-LEAD-10 — el registrador del barrido de retención, calcado de
 * `billing-cron.registrar.ts`: el job es lógica pura y ESTA clase es el único
 * lugar que conoce el reloj de pared.
 *
 * Lo que más importa acá es el caso apagado: con la bandera en false el cron
 * NO SE REGISTRA. Un barrido que BORRA filas no puede arrancar solo en un
 * entorno nuevo ni, mucho menos, en la suite de tests.
 */
describe("SiteCronRegistrar (F11-SITE-LEAD-10)", () => {
  let registry: { addCronJob: jest.Mock };
  let job: { run: jest.Mock };
  const clock = { now: () => new Date("2026-09-18T20:00:00.000Z") };

  const config = (enabled: boolean) =>
    ({ get: () => enabled }) as unknown as ConstructorParameters<typeof SiteCronRegistrar>[0];

  function build(enabled: boolean): SiteCronRegistrar {
    return new SiteCronRegistrar(
      config(enabled),
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      registry as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      job as any,
      clock,
    );
  }

  beforeEach(() => {
    registry = { addCronJob: jest.fn() };
    job = { run: jest.fn().mockResolvedValue({ deleted: 0 }) };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("con la bandera apagada NO registra nada y lo dice", () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();

    build(false).onModuleInit();

    expect(registry.addCronJob).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("SITE_LEADS_RETENTION_ENABLED"));
  });

  it("con la bandera prendida registra el barrido con su nombre", () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    const registrar = build(true);
    registrar.onModuleInit();

    expect(registry.addCronJob).toHaveBeenCalledWith("site-leads-retention", expect.anything());

    // El CronJob arranca al construirse: se detiene para no dejarlo vivo
    // entre tests (el segundo argumento es el `CronJob` real).
    (registry.addCronJob.mock.calls[0][1] as { stop: () => void }).stop();
  });

  it("la hora y la zona son constantes con nombre, no números sueltos", () => {
    expect(SITE_CRON_HOUR).toBe(4);
    expect(SITE_CRON_TZ).toBe("America/Mexico_City");
  });
});
