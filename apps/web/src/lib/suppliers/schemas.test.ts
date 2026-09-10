import { composeSupplierPhone, supplierFormSchema } from "./schemas";

/** F9-SUPPL-06 — el formulario valida el registro fiscal con el país y el teléfono como E.164. */
describe("supplierFormSchema (F9-SUPPL-06)", () => {
  const base = { name: "Norte", taxId: "", contactName: "", email: "", address: "", notes: "" };

  it("el nombre es obligatorio", () => {
    const res = supplierFormSchema("MX").safeParse({ ...base, name: "  " });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe("suppliers.form.errors.required");
  });

  it("en México un RFC mal formado rebota; vacío o válido pasa", () => {
    const mx = supplierFormSchema("MX");
    expect(mx.safeParse({ ...base, taxId: "NOPE" }).success).toBe(false);
    expect(mx.safeParse({ ...base, taxId: "NOPE" }).error?.issues[0]?.message).toBe(
      "suppliers.form.errors.taxId",
    );
    expect(mx.safeParse({ ...base, taxId: "" }).success).toBe(true);
    expect(mx.safeParse({ ...base, taxId: "DNO900101AB1" }).success).toBe(true);
  });

  it("sin país del negocio, cualquier registro fiscal vale", () => {
    expect(supplierFormSchema(null).safeParse({ ...base, taxId: "NOPE" }).success).toBe(true);
  });

  it("el teléfono sin E.164 devuelve la clave de error del namespace", () => {
    expect(composeSupplierPhone("MX", "5512345678")).toEqual({
      phone: "+525512345678",
      error: null,
    });
    expect(composeSupplierPhone("MX", "12")).toEqual({
      phone: null,
      error: "suppliers.form.errors.phone",
    });
    expect(composeSupplierPhone("MX", "")).toEqual({ phone: null, error: null });
  });
});
