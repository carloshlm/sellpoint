import type { AuthUser } from "../auth/types/auth-user";
import { UsersController } from "./users.controller";
import type { MeProfile, UserSummary, UsersService } from "./users.service";

const CURRENT_USER: AuthUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  permissions: [],
  locale: "es",
};

const UPDATED: UserSummary = {
  id: "user-1",
  email: "owner@example.com",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  status: "active",
  locale: "en",
};

/**
 * `GET /me` devuelve el bloque `tenant` desde f1-web-onboard (el
 * `OnboardingGate` del front lo lee del store), pero este mock se quedó sin él
 * y el test seguía pasando: ts-jest transpila sin chequear tipos, así que el
 * controller devolvía un perfil que en producción nunca existiría.
 */
const ME: MeProfile = {
  id: "user-1",
  email: "owner@example.com",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  defaultWarehouseId: null,
  permissions: [],
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: true,
    country: "MX",
  },
};

describe("UsersController.me (GET /me, F1-WEB-AUTH bootstrap)", () => {
  it("delega en UsersService.getMe con el user del JWT (sin @Public: exige token)", async () => {
    const usersService = {
      getMe: jest.fn().mockResolvedValue(ME),
    } as unknown as UsersService;
    const controller = new UsersController(usersService);

    const result = await controller.me(CURRENT_USER);

    expect(usersService.getMe).toHaveBeenCalledWith(CURRENT_USER);
    expect(result).toBe(ME);
  });
});

describe("UsersController.updateMe (PATCH /me)", () => {
  it("delega en UsersService.updateMe con el dto completo, el user del JWT y la meta", async () => {
    const usersService = {
      updateMe: jest.fn().mockResolvedValue(UPDATED),
    } as unknown as UsersService;
    const controller = new UsersController(usersService);

    const request = { ip: "1.2.3.4", headers: { "user-agent": "jest" } } as never;
    const dto = { locale: "en" as const, firstName: "Ana María" };
    const result = await controller.updateMe(dto, CURRENT_USER, request);

    expect(usersService.updateMe).toHaveBeenCalledWith(CURRENT_USER, dto, {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
    expect(result).toBe(UPDATED);
  });
});
