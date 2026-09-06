import { updateTaxSettingsSchema } from "./dto/tax-settings.dto";

/**
 * F4-TAX-09 — lo que el PUT de impuestos rechaza ANTES de tocar la base: dos
 * defaults (el índice parcial lo diría con un P2002 mudo), una tasa con
 * cinco decimales (la columna la redondearía callada), códigos repetidos.
 */
const grupo = (over: Record<string, unknown> = {}) => ({
  code: "VAT16",
  name: "IVA 16%",
  isDefault: true,
  rates: [{ code: "VAT", name: "IVA 16%", rate: "16" }],
  ...over,
});

describe("updateTaxSettingsSchema", () => {
  it("acepta el modo solo, la región sola, o el catálogo completo", () => {
    expect(updateTaxSettingsSchema.safeParse({ mode: "excluded" }).success).toBe(true);
    expect(updateTaxSettingsSchema.safeParse({ region: "BC" }).success).toBe(true);
    expect(updateTaxSettingsSchema.safeParse({ groups: [grupo()] }).success).toBe(true);
    expect(updateTaxSettingsSchema.safeParse({}).success).toBe(false);
  });

  it("exactamente un default entre los activos", () => {
    const dos = updateTaxSettingsSchema.safeParse({
      groups: [grupo(), grupo({ code: "VAT0", isDefault: true, rates: [] })],
    });
    expect(dos.success).toBe(false);
    const ninguno = updateTaxSettingsSchema.safeParse({ groups: [grupo({ isDefault: false })] });
    expect(ninguno.success).toBe(false);
    // Un default INACTIVO no cuenta: el activo es el que manda.
    const inactivo = updateTaxSettingsSchema.safeParse({
      groups: [grupo(), grupo({ code: "VIEJO", isDefault: true, isActive: false })],
    });
    expect(inactivo.success).toBe(true);
  });

  it("la tasa: hasta cuatro decimales, entre 0 y 100; el código, mayúsculas", () => {
    for (const rate of ["9.975", "0", "100", "16.0000"]) {
      expect(
        updateTaxSettingsSchema.safeParse({
          groups: [grupo({ rates: [{ code: "VAT", name: "x", rate }] })],
        }).success,
      ).toBe(true);
    }
    for (const rate of ["9.97500", "-1", "100.0001", "abc"]) {
      expect(
        updateTaxSettingsSchema.safeParse({
          groups: [grupo({ rates: [{ code: "VAT", name: "x", rate }] })],
        }).success,
      ).toBe(false);
    }
    expect(updateTaxSettingsSchema.safeParse({ groups: [grupo({ code: "iva 16" })] }).success).toBe(
      false,
    );
  });

  it("códigos repetidos, de grupo o de componente, rebotan", () => {
    expect(
      updateTaxSettingsSchema.safeParse({ groups: [grupo(), grupo({ isDefault: false })] }).success,
    ).toBe(false);
    expect(
      updateTaxSettingsSchema.safeParse({
        groups: [
          grupo({
            rates: [
              { code: "GST", name: "GST", rate: "5" },
              { code: "GST", name: "GST", rate: "7" },
            ],
          }),
        ],
      }).success,
    ).toBe(false);
  });
});
