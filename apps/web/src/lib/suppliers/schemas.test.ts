import { composeSupplierPhone, supplierContactSchema, supplierFormSchema } from "./schemas";

/** F9-SUPPL-06 — el formulario valida el registro fiscal con el país y el teléfono como E.164. */
describe("supplierFormSchema (F9-SUPPL-06)", () => {
  const base = {
    name: "Norte",
    taxId: "",
    contactName: "",
    jobTitle: "",
    email: "",
    address: "",
    notes: "",
  };

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

/** Un contacto adicional con datos pide su nombre; el correo, como el del contacto 1. */
describe("supplierContactSchema (2026-10-31)", () => {
  it("sin nombre devuelve la clave del nombre del contacto", () => {
    const res = supplierContactSchema.safeParse({ name: " ", email: "", jobTitle: "Cobranza" });
    expect(res.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["name", "suppliers.form.errors.contactName"],
    ]);
  });

  it("un correo mal escrito rebota con la clave de correo; vacío vale", () => {
    const base = { name: "Pedro", jobTitle: "" };
    expect(
      supplierContactSchema.safeParse({ ...base, email: "nope" }).error?.issues[0]?.message,
    ).toBe("suppliers.form.errors.email");
    expect(supplierContactSchema.safeParse({ ...base, email: "" }).success).toBe(true);
  });
});
