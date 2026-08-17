import { ExecutionContext, Logger, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TokenVerificationError } from "../services/token.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

function buildContext(headers: Record<string, string | undefined> = {}): {
  context: ExecutionContext;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request = { headers, user: undefined as unknown };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe("JwtAuthGuard", () => {
  const validPayload = {
    sub: "user-1",
    tenantId: "tenant-1",
    permissions: ["sales:create"],
    locale: "es" as const,
    iss: "sellpoint-api",
    aud: "sellpoint-app",
    iat: 1_000_000,
    exp: 1_000_900,
  };

  function buildGuard(overrides?: {
    isPublic?: boolean;
    mget?: () => Promise<[string | null, string | null]>;
  }) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(overrides?.isPublic ?? false),
    } as unknown as Reflector;
    const tokenService = {
      verifyAccessToken: jest.fn().mockReturnValue(validPayload),
    };
    const redis = {
      // El default se tipa como TUPLA: `[null, null]` se infiere como `null[]`,
      // que no es la forma que devuelve `mget` (dos posiciones, cada una
      // `string | null`) y hacía que el override y el default no coincidieran.
      mget: jest.fn(
        overrides?.mget ??
          ((): Promise<[string | null, string | null]> => Promise.resolve([null, null])),
      ),
    };
    const guard = new JwtAuthGuard(reflector, tokenService as never, redis as never);
    return { guard, reflector, tokenService, redis };
  }

  it("@Public() salta la verificación y NO llama a Redis", async () => {
    const { guard, redis, tokenService } = buildGuard({ isPublic: true });
    const { context } = buildContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.mget).not.toHaveBeenCalled();
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("sin header Authorization → 401", async () => {
    const { guard } = buildGuard();
    const { context } = buildContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("header Authorization sin prefijo Bearer → 401", async () => {
    const { guard } = buildGuard();
    const { context } = buildContext({ authorization: "Token abc123" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("token inválido (TokenVerificationError) → 401", async () => {
    const { guard, tokenService } = buildGuard();
    tokenService.verifyAccessToken.mockImplementation(() => {
      throw new TokenVerificationError("firma inválida");
    });
    const { context } = buildContext({ authorization: "Bearer token-malo" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("token con iat anterior al epoch de permisos → 401 auth.token_stale", async () => {
    const { guard } = buildGuard({
      mget: () => Promise.resolve([String(validPayload.iat + 1), null]),
    });
    const { context } = buildContext({ authorization: "Bearer token-valido" });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { message: "auth.token_stale" },
    });
  });

  it("token con iat posterior a ambos epochs → pasa y adjunta req.user", async () => {
    const { guard } = buildGuard({
      mget: () => Promise.resolve([String(validPayload.iat - 100), String(validPayload.iat - 50)]),
    });
    const { context, request } = buildContext({ authorization: "Bearer token-valido" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: validPayload.sub,
      tenantId: validPayload.tenantId,
      permissions: validPayload.permissions,
      locale: validPayload.locale,
    });
  });

  it("Redis caído → fail-open (pasa) y loguea WARN", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const { guard } = buildGuard({
      mget: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    const { context } = buildContext({ authorization: "Bearer token-valido" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
