import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from "./dto/upsert-supplier.dto";

/**
 * F9-SUPPL-02 — los cuerpos de proveedores. El nombre es obligatorio, el
 * teléfono es E.164, un update vacío no es un update, y el registro fiscal
 * pasa crudo (lo valida el service con el país del negocio).
 */
describe("DTOs de proveedores (F9-SUPPL-02)", () => {
  it("un proveedor nace con nombre; lo demás es opcional", () => {
    const parsed = createSupplierSchema.parse({ name: "  Distribuidora Norte " });
    expect(parsed.name).toBe("Distribuidora Norte");
    expect(parsed.taxId).toBeUndefined();
    expect(createSupplierSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createSupplierSchema.safeParse({}).success).toBe(false);
  });

  it("el teléfono es E.164: sin el prefijo internacional rebota con su clave", () => {
    const res = createSupplierSchema.safeParse({ name: "Norte", phone: "5512345678" });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("suppliers.invalid_phone");
    expect(createSupplierSchema.parse({ name: "Norte", phone: "+525512345678" }).phone).toBe(
      "+525512345678",
    );
  });

  it("el correo, si viene, tiene que ser un correo", () => {
    expect(createSupplierSchema.safeParse({ name: "Norte", email: "nope" }).success).toBe(false);
    expect(createSupplierSchema.parse({ name: "Norte", email: "ventas@norte.mx" }).email).toBe(
      "ventas@norte.mx",
    );
  });

  it("el registro fiscal pasa crudo: su regla depende del país y vive en el service", () => {
    expect(createSupplierSchema.parse({ name: "Norte", taxId: "lo que sea" }).taxId).toBe(
      "lo que sea",
    );
  });

  it("un update vacío rebota con suppliers.empty_update; limpiar con null vale", () => {
    const res = updateSupplierSchema.safeParse({});
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("suppliers.empty_update");
    expect(updateSupplierSchema.parse({ taxId: null, isActive: false })).toEqual({
      taxId: null,
      isActive: false,
    });
  });

  it("el listado: página 1 de 20 por defecto, tope 100, y `isActive` llega como booleano", () => {
    expect(listSuppliersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(listSuppliersQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(listSuppliersQuerySchema.parse({ isActive: "true" }).isActive).toBe(true);
    expect(listSuppliersQuerySchema.parse({ isActive: "false" }).isActive).toBe(false);
    expect(listSuppliersQuerySchema.safeParse({ isActive: "yes" }).success).toBe(false);
  });
});
