import { Logger } from "@nestjs/common";
import { WarehouseScopeMiddleware } from "./warehouse-scope.middleware";

function bearerWithClaims(
  claims: Partial<{ sub: unknown; tenantId: unknown; permissions: unknown }>,
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `Bearer ${header}.${payload}.firma-no-importa`;
}

describe("WarehouseScopeMiddleware (F1-SCOPE-03)", () => {
  const userId = "8b7e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6b";
  const tenantId = "2c9e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6c";
  const warehouseIds = ["11111111-1111-4111-8111-111111111111"];

  function buildPrismaMock(findManyResult: { warehouseId: string }[] = []) {
    const tx = { userWarehouseScope: { findMany: jest.fn().mockResolvedValue(findManyResult) } };
    return {
      withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
      tx,
    };
  }

  it("request sin token: no setea scope, no golpea la DB, sigue la cadena", async () => {
    const prisma = buildPrismaMock();
    const middleware = new WarehouseScopeMiddleware(prisma as never);
    const req = { headers: {} } as never;
    const next = jest.fn();

    await middleware.use(req, {} as never, next);

    expect((req as { scope?: unknown }).scope).toBeUndefined();
    expect(prisma.withTenantContext).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("token malformado: no lanza, no setea scope, sigue la cadena", async () => {
    const prisma = buildPrismaMock();
    const middleware = new WarehouseScopeMiddleware(prisma as never);
    const req = { headers: { authorization: "Bearer token-malo" } } as never;
    const next = jest.fn();

    await expect(middleware.use(req, {} as never, next)).resolves.not.toThrow();
    expect((req as { scope?: unknown }).scope).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("TenantAdmin (roles:manage + users:manage): bypass total, req.scope = 'all', SIN consultar la DB", async () => {
    const prisma = buildPrismaMock();
    const middleware = new WarehouseScopeMiddleware(prisma as never);
    const req = {
      headers: {
        authorization: bearerWithClaims({
          sub: userId,
          tenantId,
          permissions: ["roles:manage", "users:manage", "users:read"],
        }),
      },
    } as never;
    const next = jest.fn();

    await middleware.use(req, {} as never, next);

    expect((req as { scope?: { warehouseIds: unknown } }).scope).toEqual({ warehouseIds: "all" });
    expect(prisma.withTenantContext).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rol sin ambos permisos de gestión: filtra por los warehouseIds asignados en DB", async () => {
    const prisma = buildPrismaMock(warehouseIds.map((warehouseId) => ({ warehouseId })));
    const middleware = new WarehouseScopeMiddleware(prisma as never);
    const req = {
      headers: {
        authorization: bearerWithClaims({
          sub: userId,
          tenantId,
          permissions: ["pos:sell", "products:read"],
        }),
      },
    } as never;
    const next = jest.fn();

    await middleware.use(req, {} as never, next);

    expect((req as { scope?: { warehouseIds: unknown } }).scope).toEqual({
      warehouseIds,
    });
    expect(prisma.withTenantContext).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(prisma.tx.userWarehouseScope.findMany).toHaveBeenCalledWith({
      where: { userId },
      select: { warehouseId: true },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("solo un permiso de gestión (Manager): NO hace bypass, filtra por DB", async () => {
    const prisma = buildPrismaMock([]);
    const middleware = new WarehouseScopeMiddleware(prisma as never);
    const req = {
      headers: {
        authorization: bearerWithClaims({
          sub: userId,
          tenantId,
          permissions: ["users:manage"],
        }),
      },
    } as never;
    const next = jest.fn();

    await middleware.use(req, {} as never, next);

    expect((req as { scope?: { warehouseIds: unknown } }).scope).toEqual({ warehouseIds: [] });
    expect(prisma.withTenantContext).toHaveBeenCalledTimes(1);
  });

  it("falla la query de DB: fail-closed a warehouseIds:[], no lanza, sigue la cadena", async () => {
    const tx = {
      userWarehouseScope: { findMany: jest.fn().mockRejectedValue(new Error("db down")) },
    };
    const prisma = {
      withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const logSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const middleware = new WarehouseScopeMiddleware(prisma as never);
    const req = {
      headers: {
        authorization: bearerWithClaims({ sub: userId, tenantId, permissions: [] }),
      },
    } as never;
    const next = jest.fn();

    await expect(middleware.use(req, {} as never, next)).resolves.not.toThrow();

    expect((req as { scope?: { warehouseIds: unknown } }).scope).toEqual({ warehouseIds: [] });
    expect(next).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});
