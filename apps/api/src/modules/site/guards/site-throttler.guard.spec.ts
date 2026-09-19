import { HttpStatus, Logger } from "@nestjs/common";
import { SITE_THROTTLES } from "../site-throttle";
import { SiteThrottlerGuard } from "./site-throttler.guard";

/**
 * F11-SITE-LEAD-03 — el límite por IP de los dos endpoints públicos del sitio.
 *
 * Fail-open si Redis está caído, con WARN: mismo precedente que
 * `AuthEmailThrottlerGuard`. Degradar la ventana de throttle es mejor que
 * tirar un 500 en el formulario de contacto por un hipo de Redis.
 */
function context(throttle: unknown, ip = "203.0.113.7") {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
    __throttle: throttle,
  } as never;
}

describe("SiteThrottlerGuard (F11-SITE-LEAD-03)", () => {
  let storage: { increment: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: SiteThrottlerGuard;

  const config = (enabled: boolean) =>
    ({ get: () => enabled }) as unknown as ConstructorParameters<typeof SiteThrottlerGuard>[1];

  function build(enabled = true): SiteThrottlerGuard {
    return new SiteThrottlerGuard(
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      storage as any,
      config(enabled),
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      reflector as any,
    );
  }

  beforeEach(() => {
    storage = { increment: jest.fn().mockResolvedValue({ isBlocked: false }) };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(SITE_THROTTLES.lead) };
    guard = build();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("cuenta contra el presupuesto del handler, con la IP en la clave", async () => {
    await expect(guard.canActivate(context(SITE_THROTTLES.lead))).resolves.toBe(true);

    expect(storage.increment).toHaveBeenCalledWith(
      "throttle:site-lead:203.0.113.7",
      3_600_000,
      5,
      3_600_000,
      "site-lead",
    );
  });

  it("pasado el límite responde 429 con la clave i18n del sitio", async () => {
    storage.increment.mockResolvedValue({ isBlocked: true });

    await expect(guard.canActivate(context(SITE_THROTTLES.lead))).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { message: "site.too_many_requests" },
    });
  });

  it("el presupuesto de eventos es el generoso, y es OTRO balde", async () => {
    reflector.getAllAndOverride.mockReturnValue(SITE_THROTTLES.event);

    await guard.canActivate(context(SITE_THROTTLES.event));

    expect(storage.increment).toHaveBeenCalledWith(
      "throttle:site-event:203.0.113.7",
      60_000,
      120,
      60_000,
      "site-event",
    );
  });

  it("con THROTTLE_ENABLED apagado no toca Redis (dev y la suite entera)", async () => {
    guard = build(false);

    await expect(guard.canActivate(context(SITE_THROTTLES.lead))).resolves.toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });

  /** Renombrar o mover un handler no puede dejar un endpoint público SIN límite. */
  it("un handler sin presupuesto declarado cae al MÁS ESTRICTO, y avisa", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await guard.canActivate(context(undefined));

    expect(storage.increment).toHaveBeenCalledWith(
      expect.stringContaining("site-lead"),
      3_600_000,
      5,
      3_600_000,
      "site-lead",
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Redis caído no rompe el formulario: pasa y avisa", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    storage.increment.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(guard.canActivate(context(SITE_THROTTLES.lead))).resolves.toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });
});
