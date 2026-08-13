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

const ME: MeProfile = {
  id: "user-1",
  email: "owner@example.com",
  firstName: "Ana",
  locale: "es",
  permissions: [],
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

describe("UsersController.updateMe (PATCH /me, F1-LOCALE-05)", () => {
  it("delega en UsersService.updateLocale con el user del JWT y la meta de la request", async () => {
    const usersService = {
      updateLocale: jest.fn().mockResolvedValue(UPDATED),
    } as unknown as UsersService;
    const controller = new UsersController(usersService);

    const request = { ip: "1.2.3.4", headers: { "user-agent": "jest" } } as never;
    const result = await controller.updateMe({ locale: "en" }, CURRENT_USER, request);

    expect(usersService.updateLocale).toHaveBeenCalledWith(CURRENT_USER, "en", {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
    expect(result).toBe(UPDATED);
  });
});
