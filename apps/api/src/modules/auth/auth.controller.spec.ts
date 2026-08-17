import type { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import type { Env } from "../../config/env.schema";
import { AuthController } from "./auth.controller";
import type { AuthService } from "./auth.service";

function baseDto() {
  return {
    tenantName: "Acme",
    email: "owner@example.com",
    password: "twelve-characters",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
  };
}

const ENV_DEFAULTS: Record<string, unknown> = {
  NODE_ENV: "development",
  REFRESH_COOKIE_PATH: "/auth",
  REFRESH_TOKEN_TTL_DAYS: 7,
};

/**
 * `ConfigService` a secas es `ConfigService<Record<string|symbol, unknown>,
 * false>`, que NO es lo que el controller pide. Tiparlo con `<Env, true>` es lo
 * que hace que el mock tenga que parecerse al servicio real.
 */
function buildConfigService(): ConfigService<Env, true> {
  return { get: (key: string) => ENV_DEFAULTS[key] } as unknown as ConfigService<Env, true>;
}

describe("AuthController.registerTenant — F1-LOCALE-09 (fallback de Accept-Language)", () => {
  function buildController() {
    const authService = {
      registerTenant: jest.fn().mockResolvedValue({ tenantId: "tenant-1", userId: "user-1" }),
    } as unknown as AuthService;
    const controller = new AuthController(authService, buildConfigService());
    return { controller, authService };
  }

  it("si el DTO NO trae locale, usa req.locale (resuelto por LocaleResolverMiddleware desde Accept-Language)", async () => {
    const { controller, authService } = buildController();
    const request = {
      ip: "1.2.3.4",
      headers: { "user-agent": "jest" },
      locale: "en",
    } as never;

    await controller.registerTenant(baseDto(), request);

    expect(authService.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en" }),
      { ip: "1.2.3.4", userAgent: "jest" },
    );
  });

  it("si el DTO SÍ trae locale explícito, ese gana sobre req.locale", async () => {
    const { controller, authService } = buildController();
    const request = { ip: "1.2.3.4", headers: {}, locale: "en" } as never;

    await controller.registerTenant({ ...baseDto(), locale: "es" }, request);

    expect(authService.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "es" }),
      expect.anything(),
    );
  });

  it("si req.locale no fue seteado (middleware no corrió), cae a DEFAULT_LOCALE", async () => {
    const { controller, authService } = buildController();
    const request = { ip: "1.2.3.4", headers: {} } as never;

    await controller.registerTenant(baseDto(), request);

    expect(authService.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "es" }),
      expect.anything(),
    );
  });
});

/**
 * `as never` dejaba el mock tipado como `never`, así que `response.cookie` no
 * existía para TypeScript y las aserciones sobre la cookie no se chequeaban.
 * Se declara el espía en el tipo para poder afirmarlo.
 */
function buildResponse(): Response & { cookie: jest.Mock } {
  return { cookie: jest.fn() } as unknown as Response & { cookie: jest.Mock };
}

describe("AuthController.login/refresh/logout — cookie builder (AD-5)", () => {
  function buildController(authServiceOverrides: Partial<AuthService> = {}) {
    const authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
      forgotPassword: jest.fn().mockResolvedValue(undefined),
      resetPassword: jest.fn().mockResolvedValue(undefined),
      ...authServiceOverrides,
    } as unknown as AuthService;
    const controller = new AuthController(authService, buildConfigService());
    return { controller, authService };
  }

  it("login: setea la cookie sp_refresh con el refreshToken devuelto y NO lo expone en el body", async () => {
    const { controller } = buildController({
      login: jest.fn().mockResolvedValue({
        accessToken: "access-1",
        expiresIn: 900,
        refreshToken: "raw-refresh-1",
        refreshExpiresAt: new Date(),
        user: { id: "u1", email: "a@a.com", firstName: "Ana", locale: "es", permissions: [] },
      }),
    });
    const response = buildResponse();
    const request = { ip: "1.2.3.4", headers: {} } as never;

    const body = await controller.login(
      { email: "a@a.com", password: "twelve-characters" },
      request,
      response,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      "sp_refresh",
      "raw-refresh-1",
      expect.objectContaining({ httpOnly: true, path: "/auth" }),
    );
    expect(body).not.toHaveProperty("refreshToken");
    expect(body.accessToken).toBe("access-1");
  });

  it("refresh exitoso: setea cookie nueva con el token rotado", async () => {
    const { controller } = buildController({
      refresh: jest.fn().mockResolvedValue({
        accessToken: "access-2",
        expiresIn: 900,
        refreshToken: "raw-refresh-2",
        refreshExpiresAt: new Date(),
      }),
    });
    const response = buildResponse();
    const request = {
      ip: "1.2.3.4",
      headers: {},
      cookies: { sp_refresh: "raw-refresh-1" },
    } as never;

    await controller.refresh(request, response);

    expect(response.cookie).toHaveBeenCalledWith(
      "sp_refresh",
      "raw-refresh-2",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("refresh fallido: limpia la cookie (Max-Age=0) y propaga el error original", async () => {
    const error = new Error("token reused");
    const { controller } = buildController({ refresh: jest.fn().mockRejectedValue(error) });
    const response = buildResponse();
    const request = { ip: "1.2.3.4", headers: {}, cookies: {} } as never;

    await expect(controller.refresh(request, response)).rejects.toBe(error);
    expect(response.cookie).toHaveBeenCalledWith(
      "sp_refresh",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("logout: SIEMPRE limpia la cookie, incluso si authService.logout no encontró nada que revocar", async () => {
    const { controller, authService } = buildController();
    const response = buildResponse();
    const request = { ip: "1.2.3.4", headers: {}, cookies: { sp_refresh: "raw" } } as never;

    await controller.logout(request, response);

    expect(authService.logout).toHaveBeenCalledWith("raw", { ip: "1.2.3.4", userAgent: undefined });
    expect(response.cookie).toHaveBeenCalledWith(
      "sp_refresh",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });
});

describe("AuthController.forgotPassword/resetPassword — U5 (AUTH-REQ-08/09)", () => {
  function buildController(authServiceOverrides: Partial<AuthService> = {}) {
    const authService = {
      forgotPassword: jest.fn().mockResolvedValue(undefined),
      resetPassword: jest.fn().mockResolvedValue(undefined),
      ...authServiceOverrides,
    } as unknown as AuthService;
    const controller = new AuthController(authService, buildConfigService());
    return { controller, authService };
  }

  it("forgotPassword: delega en authService.forgotPassword y responde 202-shaped body sin filtrar nada", async () => {
    const { controller, authService } = buildController();
    const request = { ip: "1.2.3.4", headers: { "user-agent": "jest" } } as never;

    const body = await controller.forgotPassword({ email: "owner@acme.test" }, request);

    expect(authService.forgotPassword).toHaveBeenCalledWith("owner@acme.test", {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
    expect(body).toEqual({ accepted: true });
  });

  it("resetPassword: delega en authService.resetPassword con token y password", async () => {
    const { controller, authService } = buildController();
    const request = { ip: "1.2.3.4", headers: {} } as never;

    await controller.resetPassword({ token: "raw-token", password: "twelve-characters" }, request);

    expect(authService.resetPassword).toHaveBeenCalledWith("raw-token", "twelve-characters", {
      ip: "1.2.3.4",
      userAgent: undefined,
    });
  });
});

describe("AuthController.changePassword/listSessions — F1-WEB-AUTH-10 (W1 f1-auth)", () => {
  const authUser = {
    userId: "user-1",
    tenantId: "tenant-1",
    permissions: ["products:read"],
    locale: "es" as const,
  };

  function buildController(authServiceOverrides: Partial<AuthService> = {}) {
    const authService = {
      changePassword: jest.fn().mockResolvedValue({ accessToken: "access-nuevo", expiresIn: 900 }),
      listSessions: jest.fn().mockResolvedValue([]),
      ...authServiceOverrides,
    } as unknown as AuthService;
    const controller = new AuthController(authService, buildConfigService());
    return { controller, authService };
  }

  it("changePassword: pasa el user autenticado, el body y la cookie sp_refresh (para saber cuál familia preservar)", async () => {
    const { controller, authService } = buildController();
    const request = {
      ip: "1.2.3.4",
      headers: { "user-agent": "jest" },
      cookies: { sp_refresh: "raw-refresh-1" },
    } as never;

    const body = await controller.changePassword(
      { currentPassword: "twelve-characters", newPassword: "brand-new-password-12" },
      authUser,
      request,
    );

    expect(authService.changePassword).toHaveBeenCalledWith(
      authUser,
      { currentPassword: "twelve-characters", newPassword: "brand-new-password-12" },
      "raw-refresh-1",
      { ip: "1.2.3.4", userAgent: "jest" },
    );
    expect(body).toEqual({ accessToken: "access-nuevo", expiresIn: 900 });
  });

  it("changePassword: sin cookie sp_refresh pasa undefined (el servicio degrada a revocar todo)", async () => {
    const { controller, authService } = buildController();
    const request = { ip: "1.2.3.4", headers: {}, cookies: {} } as never;

    await controller.changePassword(
      { currentPassword: "twelve-characters", newPassword: "brand-new-password-12" },
      authUser,
      request,
    );

    expect(authService.changePassword).toHaveBeenCalledWith(
      authUser,
      expect.anything(),
      undefined,
      expect.anything(),
    );
  });

  it("listSessions: delega con el user y la cookie, y devuelve las sesiones tal cual (sin hashes)", async () => {
    const sessions = [
      {
        familyId: "fam-b",
        createdAt: new Date("2026-08-12T10:00:00Z"),
        expiresAt: new Date("2026-08-19T10:00:00Z"),
        current: true,
      },
    ];
    const { controller, authService } = buildController({
      listSessions: jest.fn().mockResolvedValue(sessions),
    });
    const request = { headers: {}, cookies: { sp_refresh: "raw-refresh-1" } } as never;

    await expect(controller.listSessions(authUser, request)).resolves.toEqual(sessions);
    expect(authService.listSessions).toHaveBeenCalledWith(authUser, "raw-refresh-1");
  });
});
