import { Logger } from "@nestjs/common";
import { TenantContextMiddleware } from "./tenant-context.middleware";

function bearerWithTenant(tenantId: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ tenantId })).toString("base64url");
  return `Bearer ${header}.${payload}.firma-no-importa`;
}

describe("TenantContextMiddleware (F1-TENANT-01)", () => {
  const middleware = new TenantContextMiddleware();
  const validTenantId = "8b7e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6b";

  it("request autenticada: setea req.tenantId y loguea la variable seteada", () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const req = {
      headers: { authorization: bearerWithTenant(validTenantId) },
      method: "GET",
      originalUrl: "/me",
    } as never;
    const next = jest.fn();

    middleware.use(req, {} as never, next);

    expect((req as { tenantId?: string }).tenantId).toBe(validTenantId);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toEqual(expect.stringContaining(validTenantId));
    expect(next).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
  });

  it("request sin token: no setea tenantId, no loguea, y sigue la cadena", () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const req = { headers: {}, method: "GET", originalUrl: "/health" } as never;
    const next = jest.fn();

    middleware.use(req, {} as never, next);

    expect((req as { tenantId?: string }).tenantId).toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
  });

  it("token malformado: no lanza, no setea tenantId, sigue la cadena", () => {
    const req = {
      headers: { authorization: "Bearer token-malo" },
      method: "GET",
      originalUrl: "/me",
    } as never;
    const next = jest.fn();

    expect(() => middleware.use(req, {} as never, next)).not.toThrow();
    expect((req as { tenantId?: string }).tenantId).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
