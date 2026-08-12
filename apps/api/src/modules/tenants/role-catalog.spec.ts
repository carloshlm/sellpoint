import { resolveRolePermissionCodes, TENANT_ROLE_NAMES } from "./role-catalog";

describe("resolveRolePermissionCodes", () => {
  const catalog = [
    "users:read",
    "users:manage",
    "roles:read",
    "roles:manage",
    "products:read",
    "products:manage",
    "pos:sell",
    "reports:read",
  ];

  it("TenantAdmin recibe TODOS los codes del catálogo", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.TenantAdmin).toEqual(catalog);
  });

  it("Manager recibe todo salvo users:manage y roles:manage", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.Manager).not.toContain("users:manage");
    expect(result.Manager).not.toContain("roles:manage");
    expect(result.Manager).toContain("products:manage");
  });

  it("POS_Seller solo recibe pos:sell y products:read (si existen en el catálogo)", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.POS_Seller.sort()).toEqual(["pos:sell", "products:read"]);
  });

  it("Viewer recibe solo codes que terminan en :read", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.Viewer.sort()).toEqual([
      "products:read",
      "reports:read",
      "roles:read",
      "users:read",
    ]);
  });

  it("catálogo vacío → todos los roles nacen sin permisos (degradación aceptada)", () => {
    const result = resolveRolePermissionCodes([]);
    for (const role of TENANT_ROLE_NAMES) {
      expect(result[role]).toEqual([]);
    }
  });
});
