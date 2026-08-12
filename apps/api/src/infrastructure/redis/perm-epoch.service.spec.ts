import { PermEpochService } from "./perm-epoch.service";

/**
 * F1-RBAC-04: extrae a un servicio compartido el MISMO criterio que
 * `AuthService.bumpPermEpoch` (f1-auth AD-8) — `SET` sin TTL, valor en unix
 * SEGUNDOS, fail-open con WARN si Redis está inalcanzable. RolesService
 * (bump por tenant) y UsersService (bump por usuario, al suspender) lo
 * consumen sin duplicar la lógica.
 */
describe("PermEpochService", () => {
  const NOW = new Date("2026-08-12T12:00:00Z");

  function buildService(setImpl?: jest.Mock) {
    const redis = { set: setImpl ?? jest.fn().mockResolvedValue("OK") };
    const service = new PermEpochService(redis as never);
    return { service, redis };
  }

  it("bumpTenantEpoch: SET perm-epoch:{tenantId} con el valor en unix segundos, SIN TTL", async () => {
    const { service, redis } = buildService();

    await service.bumpTenantEpoch("tenant-1", NOW);

    expect(redis.set).toHaveBeenCalledWith("perm-epoch:tenant-1", "1786536000");
    expect(redis.set).toHaveBeenCalledTimes(1);
    // Un solo argumento de valor: ninguna opción de TTL (EX/PX) pasada.
    expect(redis.set.mock.calls[0]).toHaveLength(2);
  });

  it("bumpUserEpoch: SET perm-epoch:{userId} con el valor en unix segundos, SIN TTL", async () => {
    const { service, redis } = buildService();

    await service.bumpUserEpoch("user-1", NOW);

    expect(redis.set).toHaveBeenCalledWith("perm-epoch:user-1", "1786536000");
  });

  it("Redis inalcanzable → fail-open, no propaga el error (AD-8)", async () => {
    const { service } = buildService(jest.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(service.bumpTenantEpoch("tenant-1", NOW)).resolves.toBeUndefined();
  });
});
