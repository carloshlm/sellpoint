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
  /**
   * F3-DB-05. Los tres permisos de inventario reparten así:
   *
   *  · `inventory:read`     — kardex, stock, traspasos, documentos (Viewer lo
   *    recibe solo porque termina en `:read`, que es la regla implícita).
   *  · `inventory:movement` — crear y confirmar movimientos.
   *  · `inventory:manage`   — cancelar un traspaso (el stock NO vuelve) y
   *    aprobar un inventario físico (reescribe el saldo contra lo contado).
   *    Las dos son decisiones que un Manager no debería poder tomar solo, por
   *    eso entra a `MANAGER_EXCLUDED_CODES`.
   */
  describe("permisos de inventario (F3-DB-05)", () => {
    const CODES = ["inventory:read", "inventory:movement", "inventory:manage"];

    it("TenantAdmin recibe los tres", () => {
      const result = resolveRolePermissionCodes(CODES);
      expect(result.TenantAdmin).toEqual(expect.arrayContaining(CODES));
    });

    it("Manager mueve inventario pero NO aprueba conteos ni cancela traspasos", () => {
      const result = resolveRolePermissionCodes(CODES);

      expect(result.Manager).toEqual(
        expect.arrayContaining(["inventory:read", "inventory:movement"]),
      );
      expect(result.Manager).not.toContain("inventory:manage");
    });

    it("Viewer solo lee", () => {
      const result = resolveRolePermissionCodes(CODES);

      expect(result.Viewer).toEqual(["inventory:read"]);
    });

    it("POS_Seller no recibe ninguno: F4 decide qué necesita el POS", () => {
      const result = resolveRolePermissionCodes(CODES);

      expect(result.POS_Seller).toEqual([]);
    });
  });

  /**
   * F3-SVC-02 — el catálogo de servicios.
   *
   * A diferencia de `inventory:manage`, gestionar servicios NO entra a
   * `MANAGER_EXCLUDED_CODES`: dar de alta un corte de pelo o cambiarle el
   * precio es tarea diaria, y nada de eso reescribe historia.
   *
   * La excepción real está en POS_Seller: es el ÚNICO set explícito, y sin
   * `services:read` el vendedor no tendría qué vender cuando llegue F4.
   */
  describe("permisos de servicios (F3-SVC-02)", () => {
    const CODES = ["services:read", "services:manage"];

    it("TenantAdmin recibe los dos", () => {
      expect(resolveRolePermissionCodes(CODES).TenantAdmin).toEqual(expect.arrayContaining(CODES));
    });

    it("Manager también los dos: gestionar servicios es tarea diaria", () => {
      expect(resolveRolePermissionCodes(CODES).Manager).toEqual(expect.arrayContaining(CODES));
    });

    it("Viewer solo lee", () => {
      expect(resolveRolePermissionCodes(CODES).Viewer).toEqual(["services:read"]);
    });

    it("POS_Seller LEE servicios: en F4 los vende, y sin leerlos no hay qué vender", () => {
      const result = resolveRolePermissionCodes(CODES);

      expect(result.POS_Seller).toEqual(["services:read"]);
      // Pero no los administra: cambiar un precio no es tarea de mostrador.
      expect(result.POS_Seller).not.toContain("services:manage");
    });
  });
});
