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

  /**
   * Contactos de proveedor (Carlos, 2026-10-31): el contacto principal gana
   * «Puesto / Cargo», la dirección se desglosa como en Sucursales y el
   * proveedor admite hasta 10 contactos adicionales (Carlos topó a 10).
   */
  describe("puesto, dirección desglosada y contactos adicionales", () => {
    it("un alta sin los campos nuevos sigue valiendo igual que antes", () => {
      const parsed = createSupplierSchema.parse({ name: "Norte", contactName: "Rosa" });
      expect(parsed).toEqual({ name: "Norte", contactName: "Rosa" });
    });

    it("el puesto y la dirección se recortan, y «» cuenta como sin dato", () => {
      const parsed = createSupplierSchema.parse({
        name: "Norte",
        jobTitle: "  Gerente de ventas ",
        addressLine2: " Col. Centro ",
        city: "",
        region: " JAL ",
        postalCode: "",
      });
      expect(parsed).toMatchObject({
        jobTitle: "Gerente de ventas",
        addressLine2: "Col. Centro",
        city: null,
        region: "JAL",
        postalCode: null,
      });
      expect(
        createSupplierSchema.safeParse({ name: "Norte", jobTitle: "x".repeat(121) }).success,
      ).toBe(false);
      expect(createSupplierSchema.safeParse({ name: "Norte", region: "123456789" }).success).toBe(
        false,
      );
      expect(
        createSupplierSchema.safeParse({ name: "Norte", postalCode: "1".repeat(17) }).success,
      ).toBe(false);
    });

    it("los contactos llegan en orden, con nombre obligatorio y lo demás opcional", () => {
      const parsed = createSupplierSchema.parse({
        name: "Norte",
        contacts: [
          { name: " Luis ", phone: "+525511112222", email: "luis@norte.mx", jobTitle: " Compras " },
          { name: "Ana", phone: null, email: null, jobTitle: "" },
          { name: "Eva" },
        ],
      });
      expect(parsed.contacts).toEqual([
        { name: "Luis", phone: "+525511112222", email: "luis@norte.mx", jobTitle: "Compras" },
        { name: "Ana", phone: null, email: null, jobTitle: null },
        { name: "Eva" },
      ]);
      expect(
        createSupplierSchema.safeParse({ name: "Norte", contacts: [{ name: "  " }] }).success,
      ).toBe(false);
      expect(
        createSupplierSchema.safeParse({ name: "Norte", contacts: [{ name: "x".repeat(121) }] })
          .success,
      ).toBe(false);
      expect(
        createSupplierSchema.safeParse({
          name: "Norte",
          contacts: [{ name: "Ana", jobTitle: "x".repeat(121) }],
        }).success,
      ).toBe(false);
    });

    it("el teléfono de un contacto es E.164 y rebota con suppliers.invalid_phone", () => {
      const res = createSupplierSchema.safeParse({
        name: "Norte",
        contacts: [{ name: "Ana", phone: "5512345678" }],
      });
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]).toMatchObject({
        path: ["contacts", 0, "phone"],
        message: "suppliers.invalid_phone",
      });
    });

    it("el correo de un contacto, si viene, tiene que ser un correo", () => {
      expect(
        createSupplierSchema.safeParse({
          name: "Norte",
          contacts: [{ name: "Ana", email: "nope" }],
        }).success,
      ).toBe(false);
    });

    it("caben 10 contactos adicionales; el 11 rebota", () => {
      const contactos = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ name: `Contacto ${i + 2}` }));
      expect(
        createSupplierSchema.safeParse({ name: "Norte", contacts: contactos(10) }).success,
      ).toBe(true);
      const res = createSupplierSchema.safeParse({ name: "Norte", contacts: contactos(11) });
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]).toMatchObject({ path: ["contacts"], code: "too_big" });
      expect(updateSupplierSchema.safeParse({ contacts: contactos(11) }).success).toBe(false);
    });

    it("en la edición todo es anulable y `contacts` puede venir solo", () => {
      expect(
        updateSupplierSchema.parse({
          jobTitle: null,
          addressLine2: null,
          city: "",
          region: null,
          postalCode: null,
        }),
      ).toEqual({ jobTitle: null, addressLine2: null, city: null, region: null, postalCode: null });
      expect(updateSupplierSchema.parse({ contacts: [] })).toEqual({ contacts: [] });
      expect(updateSupplierSchema.parse({ contacts: null })).toEqual({ contacts: null });
      expect(updateSupplierSchema.parse({ contacts: [{ name: "Ana" }] })).toEqual({
        contacts: [{ name: "Ana" }],
      });
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
