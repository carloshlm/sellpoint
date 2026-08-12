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

describe("AuthController.registerTenant — F1-LOCALE-09 (fallback de Accept-Language)", () => {
  function buildController() {
    const authService = {
      registerTenant: jest.fn().mockResolvedValue({ tenantId: "tenant-1", userId: "user-1" }),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
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
