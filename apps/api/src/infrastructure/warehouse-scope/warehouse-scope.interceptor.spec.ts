import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { of } from "rxjs";
import type { AuthUser } from "../../modules/auth/types/auth-user";
import { WarehouseScopeInterceptor } from "./warehouse-scope.interceptor";

function userWith(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: "8b7e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6b",
    tenantId: "2c9e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6c",
    permissions: [],
    locale: "es",
    ...overrides,
  };
}

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildPrismaMock(findManyResult: { warehouseId: string }[] = []) {
  const tx = { userWarehouseScope: { findMany: jest.fn().mockResolvedValue(findManyResult) } };
  return {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    tx,
  };
}

const nextHandler: CallHandler = { handle: () => of("handler-result") };

describe("WarehouseScopeInterceptor (remediación CRITICAL C1/C2, verify-report f1-scope)", () => {
  const warehouseIds = ["11111111-1111-4111-8111-111111111111"];

  it("sin req.user (ruta @Public o request no autenticado): NO calcula scope, NO golpea la DB", async () => {
    const prisma = buildPrismaMock();
    const interceptor = new WarehouseScopeInterceptor(prisma as never);
    const req: Record<string, unknown> = {};

    await interceptor.intercept(contextWithRequest(req), nextHandler);

    expect(req.scope).toBeUndefined();
    expect(prisma.withTenantContext).not.toHaveBeenCalled();
  });

  it("TenantAdmin (roles:manage + users:manage) verificado: bypass total, req.scope = 'all', SIN consultar la DB", async () => {
    const prisma = buildPrismaMock();
    const interceptor = new WarehouseScopeInterceptor(prisma as never);
    const req: Record<string, unknown> = {
      user: userWith({ permissions: ["roles:manage", "users:manage", "users:read"] }),
    };

    await interceptor.intercept(contextWithRequest(req), nextHandler);

    expect(req.scope).toEqual({ warehouseIds: "all" });
    expect(prisma.withTenantContext).not.toHaveBeenCalled();
  });

  it("rol sin ambos permisos de gestión: filtra por los warehouseIds asignados en DB, usando el tenantId VERIFICADO de req.user", async () => {
    const prisma = buildPrismaMock(warehouseIds.map((warehouseId) => ({ warehouseId })));
    const interceptor = new WarehouseScopeInterceptor(prisma as never);
    const user = userWith({ permissions: ["pos:sell", "products:read"] });
    const req: Record<string, unknown> = { user };

    await interceptor.intercept(contextWithRequest(req), nextHandler);

    expect(req.scope).toEqual({ warehouseIds });
    expect(prisma.withTenantContext).toHaveBeenCalledWith(user.tenantId, expect.any(Function));
    expect(prisma.tx.userWarehouseScope.findMany).toHaveBeenCalledWith({
      where: { userId: user.userId },
      select: { warehouseId: true },
    });
  });

  it("solo un permiso de gestión (Manager): NO hace bypass, filtra por DB", async () => {
    // El bypass exige LOS DOS codes de TenantAdmin. Con uno solo, el scope
    // sale de la DB — se le asignan filas justamente para distinguir "filtró
    // por DB" de "hizo bypass": ambos casos sin filas darían "all" desde
    // F2-SCOPE-01 y el test no probaría nada.
    const prisma = buildPrismaMock([{ warehouseId: "w-1" }]);
    const interceptor = new WarehouseScopeInterceptor(prisma as never);
    const req: Record<string, unknown> = { user: userWith({ permissions: ["users:manage"] }) };

    await interceptor.intercept(contextWithRequest(req), nextHandler);

    expect(req.scope).toEqual({ warehouseIds: ["w-1"] });
    expect(prisma.withTenantContext).toHaveBeenCalledTimes(1);
  });

  it("F2-SCOPE-01: SIN filas asignadas ve TODOS los almacenes (default permisivo)", async () => {
    // ARQUITECTURA § 3.4. La restricción por almacén es opt-in: se limita a
    // quien se le asigna un alcance explícito. Con `[]`, un tenant chico —un
    // almacén, nadie con scope— no vería nada de su propio inventario.
    const prisma = buildPrismaMock([]);
    const interceptor = new WarehouseScopeInterceptor(prisma as never);
    const req: Record<string, unknown> = { user: userWith({ permissions: ["products:read"] }) };

    await interceptor.intercept(contextWithRequest(req), nextHandler);

    expect(req.scope).toEqual({ warehouseIds: "all" });
    // Y NO por bypass: la consulta a la DB igual se hizo.
    expect(prisma.withTenantContext).toHaveBeenCalledTimes(1);
  });

  it("falla la query de DB: fail-closed a warehouseIds:[], no lanza", async () => {
    const tx = {
      userWarehouseScope: { findMany: jest.fn().mockRejectedValue(new Error("db down")) },
    };
    const prisma = {
      withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const logSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const interceptor = new WarehouseScopeInterceptor(prisma as never);
    const req: Record<string, unknown> = { user: userWith({ permissions: [] }) };

    await expect(
      interceptor.intercept(contextWithRequest(req), nextHandler),
    ).resolves.toBeDefined();

    expect(req.scope).toEqual({ warehouseIds: [] });
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  it("deja pasar el resultado del handler sin transformarlo", async () => {
    const prisma = buildPrismaMock();
    const interceptor = new WarehouseScopeInterceptor(prisma as never);
    const req: Record<string, unknown> = {};

    const result = await interceptor.intercept(contextWithRequest(req), nextHandler);
    const emitted: unknown[] = [];
    result.subscribe((value) => emitted.push(value));

    expect(emitted).toEqual(["handler-result"]);
  });
});
