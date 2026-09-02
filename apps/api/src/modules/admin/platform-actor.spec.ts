import { platformAdminActor, SCOPE_ALL } from "./platform-actor";

/**
 * F9-ADMIN-01 — el actor sintético con el que el dueño de la plataforma lee
 * los datos de OTRO negocio: el tenant es el de la URL, nunca el suyo.
 */
describe("platformAdminActor (F9-ADMIN-01)", () => {
  const admin = {
    userId: "admin-1",
    tenantId: "tenant-del-admin",
    permissions: ["tenants:manage"],
    locale: "es" as const,
  };

  it("mira el tenant de la URL y conserva quién es el admin", () => {
    const actor = platformAdminActor("T2", admin);
    expect(actor.tenantId).toBe("T2");
    expect(actor.tenantId).not.toBe(admin.tenantId);
    expect(actor.userId).toBe("admin-1");
    expect(actor.locale).toBe("es");
  });

  it("lleva los permisos que los services de reportes miran (el valor del inventario es dinero)", () => {
    const actor = platformAdminActor("T2", admin);
    expect(actor.permissions).toEqual(expect.arrayContaining(["reports:read", "inventory:read"]));
    // Y NO hereda los del admin en su propio negocio.
    expect(actor.permissions).not.toContain("tenants:manage");
  });

  it("el alcance es TODOS los almacenes: nunca el del admin en su tenant", () => {
    expect(SCOPE_ALL).toEqual({ warehouseIds: "all" });
  });
});
