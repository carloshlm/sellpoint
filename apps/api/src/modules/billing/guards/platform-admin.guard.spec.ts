import type { ExecutionContext } from "@nestjs/common";
import { PlatformAdminGuard } from "./platform-admin.guard";

/**
 * F7-ADMIN-01 — la puerta del backoffice: CUATRO llaves en AND. El flag en
 * la base y el email en la whitelist del env se exigen JUNTOS para que ni un
 * UPDATE malicioso ni un email reasignado basten solos; active y verificado
 * cierran los otros dos flancos. El flag NO viaja en el JWT a propósito: se
 * consulta por PK en cada request de /admin/* — revocarlo es inmediato, sin
 * esperar la expiración de un token.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

describe("PlatformAdminGuard (F7-ADMIN-01)", () => {
  let tx: { user: { findUnique: jest.Mock } };
  let prisma: { withTenantContext: jest.Mock };
  let guard: PlatformAdminGuard;

  const contexto = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const filaAdmin = (extra: Record<string, unknown> = {}) => ({
    isPlatformAdmin: true,
    email: "carlos@sellpointy.com",
    status: "active",
    emailVerifiedAt: new Date(),
    ...extra,
  });

  const config = {
    get: jest.fn().mockReturnValue("carlos@sellpointy.com, backup@sellpointy.com"),
  };

  beforeEach(() => {
    tx = { user: { findUnique: jest.fn().mockResolvedValue(filaAdmin()) } };
    prisma = {
      withTenantContext: jest.fn((_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    guard = new PlatformAdminGuard(prisma as any, config as any);
  });

  it("con las cuatro llaves pasa (flag + whitelist + active + verificado)", async () => {
    await expect(guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT }))).resolves.toBe(
      true,
    );
  });

  it("la whitelist compara sin mayúsculas y tolera espacios", async () => {
    tx.user.findUnique.mockResolvedValue(filaAdmin({ email: "Backup@Sellpointy.com" }));
    await expect(guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT }))).resolves.toBe(
      true,
    );
  });

  it("flag en la base SIN email en la whitelist → 403 (un UPDATE no basta)", async () => {
    tx.user.findUnique.mockResolvedValue(filaAdmin({ email: "intruso@evil.com" }));
    await expect(
      guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT })),
    ).rejects.toMatchObject({ status: 403, response: { message: "billing.not_platform_admin" } });
  });

  it("email en la whitelist SIN el flag → 403 (un email reasignado no basta)", async () => {
    tx.user.findUnique.mockResolvedValue(filaAdmin({ isPlatformAdmin: false }));
    await expect(
      guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("suspendido o sin verificar → 403", async () => {
    tx.user.findUnique.mockResolvedValue(filaAdmin({ status: "suspended" }));
    await expect(
      guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT })),
    ).rejects.toMatchObject({ status: 403 });

    tx.user.findUnique.mockResolvedValue(filaAdmin({ emailVerifiedAt: null }));
    await expect(
      guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("sin request.user o sin fila → 403 fail-closed", async () => {
    await expect(guard.canActivate(contexto(undefined))).rejects.toMatchObject({ status: 403 });

    tx.user.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("con la whitelist vacía nadie pasa — ni con el flag prendido", async () => {
    config.get.mockReturnValue("");
    await expect(
      guard.canActivate(contexto({ userId: USER_ID, tenantId: TENANT })),
    ).rejects.toMatchObject({ status: 403 });
  });
});
