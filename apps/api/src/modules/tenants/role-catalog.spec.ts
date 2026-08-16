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
    "tenants:manage",
    // F2-DB-10
    "catalogs:read",
    "catalogs:write",
    "catalogs:manage",
    "warehouses:read",
    "warehouses:manage",
  ];

  it("TenantAdmin recibe TODOS los codes del catálogo", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.TenantAdmin).toEqual(catalog);
  });

  it("Manager no administra usuarios, roles, el negocio ni la ESTRUCTURA del catálogo", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.Manager).not.toContain("users:manage");
    expect(result.Manager).not.toContain("roles:manage");
    // F1-WEB-ONBOARD-01 (D4 del design): configurar el negocio tampoco es
    // tarea de Manager.
    expect(result.Manager).not.toContain("tenants:manage");
    // F2-DB-10: definir qué campos existen cambia la forma de los datos de
    // todo el negocio — no es operación diaria.
    expect(result.Manager).not.toContain("catalogs:manage");
  });

  it("Manager SÍ opera el día a día: registros, productos y almacenes", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.Manager).toContain("products:manage");
    expect(result.Manager).toContain("catalogs:write");
    expect(result.Manager).toContain("warehouses:manage");
  });

  it("POS_Seller solo recibe pos:sell y products:read (si existen en el catálogo)", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.POS_Seller.sort()).toEqual(["pos:sell", "products:read"]);
  });

  it("Viewer recibe solo codes que terminan en :read", () => {
    const result = resolveRolePermissionCodes(catalog);
    expect(result.Viewer.sort()).toEqual([
      "catalogs:read",
      "products:read",
      "reports:read",
      "roles:read",
      "users:read",
      "warehouses:read",
    ]);
  });

  it("catálogo vacío → todos los roles nacen sin permisos (degradación aceptada)", () => {
    const result = resolveRolePermissionCodes([]);
    for (const role of TENANT_ROLE_NAMES) {
      expect(result[role]).toEqual([]);
    }
  });
});
