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

  /**
   * F4-DB-03. `pos:view` no es un permiso nuevo inventado acá: VISTAS §9.3 lo
   * exigía desde el diseño original y NO existía en el catálogo — un permiso
   * fantasma que la atomización de F4 detectó y que nace aquí en vez de
   * heredarse el hueco.
   */
  describe("permisos del punto de venta (F4-DB-03)", () => {
    const CODES = ["pos:sell", "pos:quote", "pos:view"];

    it("TenantAdmin recibe los tres", () => {
      expect(resolveRolePermissionCodes(CODES).TenantAdmin.sort()).toEqual([
        "pos:quote",
        "pos:sell",
        "pos:view",
      ]);
    });

    it("Manager también: cotizar y consultar el historial son tarea diaria", () => {
      expect(resolveRolePermissionCodes(CODES).Manager.sort()).toEqual([
        "pos:quote",
        "pos:sell",
        "pos:view",
      ]);
    });

    it("POS_Seller recibe los tres: vende, cotiza y reimprime", () => {
      expect(resolveRolePermissionCodes(CODES).POS_Seller.sort()).toEqual([
        "pos:quote",
        "pos:sell",
        "pos:view",
      ]);
    });

    /**
     * **El caso que la regla del `:read` no alcanzaba.** `pos:view` es lectura
     * pura pero se llama `:view`, así que `readCodes` lo dejaba fuera y el
     * auditor no podía ver las ventas que vino a auditar. Va explícito en
     * `VIEWER_EXTRA_CODES`; este test es lo que impide que alguien lo saque
     * "porque no termina en :read".
     */
    it("Viewer VE el historial aunque el code no termine en `:read`", () => {
      const result = resolveRolePermissionCodes(CODES);

      expect(result.Viewer).toEqual(["pos:view"]);
      // Pero no cotiza: emitir un documento no es leer.
      expect(result.Viewer).not.toContain("pos:quote");
      expect(result.Viewer).not.toContain("pos:sell");
    });

    /**
     * El caso de Carlos: una recepción que cotiza sin poder cobrar. No lo
     * resuelve un rol base sino un rol CUSTOM con un solo permiso — y el
     * catálogo tiene que permitirlo sin trucos.
     */
    it("`pos:quote` es independiente de `pos:sell`: se puede cotizar sin cobrar", () => {
      const soloCotizar = resolveRolePermissionCodes(["pos:quote"]);

      expect(soloCotizar.TenantAdmin).toEqual(["pos:quote"]);
      expect(soloCotizar.POS_Seller).toEqual(["pos:quote"]);
      expect(soloCotizar.POS_Seller).not.toContain("pos:sell");
    });
  });
});
