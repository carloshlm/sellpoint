import { ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { AuthEmailThrottlerGuard } from "./auth-email-throttler.guard";

const DEFAULT_ENV = {
  THROTTLE_ENABLED: true,
  THROTTLE_AUTH_IP_LIMIT: 5,
  THROTTLE_AUTH_IP_TTL_SEC: 900,
  THROTTLE_AUTH_EMAIL_LIMIT: 10,
  THROTTLE_AUTH_EMAIL_TTL_SEC: 3600,
};

function buildContext(opts: {
  handlerName: string;
  ip?: string;
  body?: Record<string, unknown>;
}): ExecutionContext {
  const request = { ip: opts.ip ?? "1.2.3.4", body: opts.body ?? {} };
  return {
    getHandler: () => ({ name: opts.handlerName }),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(overrides?: {
  env?: Partial<typeof DEFAULT_ENV>;
  increment?: (key: string) => Promise<{ isBlocked: boolean }>;
}) {
  const env = { ...DEFAULT_ENV, ...overrides?.env };
  const configService = {
    get: jest.fn((key: keyof typeof DEFAULT_ENV) => env[key]),
  };
  const increment = overrides?.increment ?? (() => Promise.resolve({ isBlocked: false }));
  const storage = {
    increment: jest.fn((key: string) => increment(key)),
  };
  const guard = new AuthEmailThrottlerGuard(storage as never, configService as never);
  return { guard, storage, configService };
}

describe("AuthEmailThrottlerGuard", () => {
  it("THROTTLE_ENABLED=false → permite siempre sin tocar la storage", async () => {
    const { guard, storage } = buildGuard({ env: { THROTTLE_ENABLED: false } });
    const context = buildContext({ handlerName: "login", body: { email: "a@b.com" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });

  it("IP bloqueada (auth-ip) → 429 auth.too_many_attempts, key = throttle:auth-ip:{ip}", async () => {
    const { guard, storage } = buildGuard({
      increment: (key) => Promise.resolve({ isBlocked: key.startsWith("throttle:auth-ip:") }),
    });
    const context = buildContext({ handlerName: "verifyEmail", ip: "9.9.9.9" });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { message: "auth.too_many_attempts" },
    });
    expect(storage.increment).toHaveBeenCalledWith(
      "throttle:auth-ip:9.9.9.9",
      900_000,
      5,
      900_000,
      "auth-ip",
    );
  });

  it("auth-ip aplica en CUALQUIER handler de /auth/* (no solo login/forgotPassword)", async () => {
    const { guard, storage } = buildGuard();
    const context = buildContext({ handlerName: "logout" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledWith(
      expect.stringContaining("throttle:auth-ip:"),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      "auth-ip",
    );
  });

  it("handler NO es login/forgotPassword → NUNCA chequea auth-email, aunque el body traiga email", async () => {
    const { guard, storage } = buildGuard();
    const context = buildContext({
      handlerName: "registerTenant",
      body: { email: "nuevo@acme.com" },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1); // solo auth-ip
    expect(storage.increment).not.toHaveBeenCalledWith(
      expect.stringContaining("throttle:auth-email:"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("handler=login SIN email en el body → no aplica auth-email (delega al de IP)", async () => {
    const { guard, storage } = buildGuard();
    const context = buildContext({ handlerName: "login", body: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
  });

  it("handler=login con email bloqueado (auth-email) → 429 auth.too_many_attempts, MISMA clave que IP", async () => {
    const { guard } = buildGuard({
      increment: (key) => Promise.resolve({ isBlocked: key.startsWith("throttle:auth-email:") }),
    });
    const context = buildContext({
      handlerName: "login",
      body: { email: "victima@acme.com" },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { message: "auth.too_many_attempts" },
    });
  });

  it("handler=forgotPassword también aplica auth-email", async () => {
    const { guard, storage } = buildGuard();
    const context = buildContext({
      handlerName: "forgotPassword",
      body: { email: "alguien@acme.com" },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledWith(
      "throttle:auth-email:alguien@acme.com",
      3_600_000,
      10,
      3_600_000,
      "auth-email",
    );
  });

  it("normaliza el email (trim + lowercase) antes de trackear", async () => {
    const { guard, storage } = buildGuard();
    const context = buildContext({
      handlerName: "login",
      body: { email: "  Alguien@ACME.com  " },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledWith(
      "throttle:auth-email:alguien@acme.com",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      "auth-email",
    );
  });

  it("email no-string en el body (payload inválido) → no revienta, no aplica auth-email", async () => {
    const { guard, storage } = buildGuard();
    const context = buildContext({ handlerName: "login", body: { email: 123 } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
  });

  it("Redis caído en el chequeo de IP → fail-open, permite la request (no revienta el login)", async () => {
    const { guard } = buildGuard({
      increment: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    const context = buildContext({ handlerName: "login", body: { email: "a@b.com" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("Redis caído en el chequeo de email → fail-open, permite la request", async () => {
    const { guard } = buildGuard({
      increment: (key) =>
        key.startsWith("throttle:auth-email:")
          ? Promise.reject(new Error("ECONNREFUSED"))
          : Promise.resolve({ isBlocked: false }),
    });
    const context = buildContext({ handlerName: "login", body: { email: "a@b.com" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  // F1-WEB-AUTH-10: `GET /auth/sessions` es una LECTURA autenticada que la
  // página de perfil dispara en cada visita. Con 5/900s por IP, tres visitas
  // dejarían al usuario (y a toda su oficina detrás del mismo NAT) sin poder
  // ni siquiera loguearse. El throttle de IP existe para el adivinado de
  // credenciales SIN autenticar; esta ruta ya exige un JWT válido.
  it("listSessions queda EXENTO del throttle de IP (lectura autenticada, no superficie de adivinado)", async () => {
    const { guard, storage } = buildGuard({
      increment: () => Promise.resolve({ isBlocked: true }),
    });
    const context = buildContext({ handlerName: "listSessions" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });

  it("changePassword SÍ consume el throttle de IP: verificar la password actual es adivinado de credenciales", async () => {
    const { guard, storage } = buildGuard({
      increment: () => Promise.resolve({ isBlocked: true }),
    });
    const context = buildContext({ handlerName: "changePassword" });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { message: "auth.too_many_attempts" },
    });
    expect(storage.increment).toHaveBeenCalledWith(
      expect.stringContaining("throttle:auth-ip:"),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      "auth-ip",
    );
  });

  it("un error de throttle NO es instancia de HttpException genérica sin status — siempre HttpException 429", async () => {
    const { guard } = buildGuard({ increment: () => Promise.resolve({ isBlocked: true }) });
    const context = buildContext({ handlerName: "login" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
  });
});
