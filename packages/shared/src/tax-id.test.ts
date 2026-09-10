import { describe, expect, it } from "vitest";
import { TAX_CURATED_COUNTRIES } from "./tax-defaults";
import { isTaxId, normalizeTaxId, TAX_ID_FORMATS, taxIdExample } from "./tax-id";

/**
 * F1-TAXID-01 — el registro fiscal por país: se normaliza ANTES de validar
 * (la regla nunca rechaza a un negocio real por una minúscula o un guion) y
 * solo hay patrón donde hay una fuente oficial; sin país o sin patrón, todo
 * vale — la ley de `isPostalCode`.
 */
describe("normalizeTaxId", () => {
  it("México: mayúsculas y sin espacios", () => {
    expect(normalizeTaxId("MX", " abc010101ab1 ")).toBe("ABC010101AB1");
  });

  it("Canadá: el BN con su cuenta GST/HST, con el espacio canónico", () => {
    expect(normalizeTaxId("CA", "123456789rt0001")).toBe("123456789 RT0001");
    expect(normalizeTaxId("CA", "123456789")).toBe("123456789");
  });

  it("Estados Unidos, Argentina, Brasil, Chile y Venezuela: la forma canónica desde los dígitos", () => {
    expect(normalizeTaxId("US", "123456789")).toBe("12-3456789");
    expect(normalizeTaxId("AR", "20123456786")).toBe("20-12345678-6");
    expect(normalizeTaxId("BR", "11222333000181")).toBe("11.222.333/0001-81");
    expect(normalizeTaxId("CL", "76.123.456-7")).toBe("76123456-7");
    expect(normalizeTaxId("CL", "11111111-1")).toBe("11111111-1");
    expect(normalizeTaxId("VE", "j123456789")).toBe("J-12345678-9");
  });

  it("sin país o sin patrón: recortado y en mayúsculas, nada más", () => {
    expect(normalizeTaxId(null, " abc ")).toBe("ABC");
    expect(normalizeTaxId("JP", "t123 456")).toBe("T123 456");
    expect(normalizeTaxId("PA", "8-123-456 dv 12")).toBe("8-123-456 DV 12");
  });
});

describe("isTaxId", () => {
  it("México: 12 (moral) o 13 (física) con la Ñ y el & del SAT; 14 caracteres no", () => {
    expect(isTaxId("MX", "ABC010101AB1")).toBe(true);
    expect(isTaxId("MX", "XAXX010101000")).toBe(true);
    expect(isTaxId("MX", "abc010101ab1")).toBe(true);
    expect(isTaxId("MX", "CINCO8507223N4")).toBe(false);
    expect(isTaxId("MX", "ABC01010")).toBe(false);
  });

  it("Canadá: nueve dígitos, con o sin RT0001; un texto con letras delante no", () => {
    expect(isTaxId("CA", "123456789 RT0001")).toBe(true);
    expect(isTaxId("CA", "123456789rt0001")).toBe(true);
    expect(isTaxId("CA", "123456789")).toBe(true);
    expect(isTaxId("CA", "CAN67843554")).toBe(false);
  });

  it("Estados Unidos, Argentina, Brasil, Chile: con o sin separadores", () => {
    expect(isTaxId("US", "12-3456789")).toBe(true);
    expect(isTaxId("US", "123456789")).toBe(true);
    expect(isTaxId("US", "1234567")).toBe(false);
    expect(isTaxId("AR", "20-12345678-6")).toBe(true);
    expect(isTaxId("AR", "2012345678")).toBe(false);
    expect(isTaxId("BR", "11.222.333/0001-81")).toBe(true);
    expect(isTaxId("BR", "11222333000181")).toBe(true);
    expect(isTaxId("CL", "76.123.456-0")).toBe(true);
    expect(isTaxId("CL", "11111111-1")).toBe(true);
    expect(isTaxId("CL", "123-4")).toBe(false);
  });

  it("España: CIF, DNI y NIE; Alemania con su DE; Reino Unido VAT o Company Number", () => {
    expect(isTaxId("ES", "B12345678")).toBe(true);
    expect(isTaxId("ES", "12345678Z")).toBe(true);
    expect(isTaxId("ES", "X1234567L")).toBe(true);
    expect(isTaxId("ES", "1234")).toBe(false);
    expect(isTaxId("DE", "DE123456789")).toBe(true);
    expect(isTaxId("DE", "123456789")).toBe(false);
    expect(isTaxId("GB", "GB123456789")).toBe(true);
    expect(isTaxId("GB", "AB123456")).toBe(true);
    expect(isTaxId("GB", "12")).toBe(false);
  });

  it("vacío nunca es inválido; sin país o sin patrón todo vale", () => {
    expect(isTaxId("MX", "")).toBe(true);
    expect(isTaxId(null, "lo que sea")).toBe(true);
    expect(isTaxId("JP", "T1234567890123")).toBe(true);
    expect(isTaxId("NI", "J0310000000000")).toBe(true);
    expect(isTaxId("PA", "155612345-2-2019 DV 45")).toBe(true);
    expect(isTaxId("BZ", "123456")).toBe(true);
  });
});

describe("taxIdExample y cobertura", () => {
  it("el ejemplo existe donde hay patrón y es null donde no", () => {
    expect(taxIdExample("MX")).toBe("ABC010101AB1");
    expect(taxIdExample("CA")).toBe("123456789 RT0001");
    expect(taxIdExample("PA")).toBeNull();
    expect(taxIdExample(null)).toBeNull();
  });

  it("toda clave de TAX_ID_FORMATS es un país curado, y cada ejemplo cumple su propio patrón", () => {
    for (const [country, format] of Object.entries(TAX_ID_FORMATS)) {
      expect(TAX_CURATED_COUNTRIES).toContain(country);
      expect(isTaxId(country, format.example)).toBe(true);
      // El ejemplo ya está en forma canónica: normalizarlo no lo cambia.
      expect(normalizeTaxId(country, format.example)).toBe(format.example);
    }
    // 23 con fuente oficial; NI, PA y BZ sin patrón hasta tenerla.
    expect(Object.keys(TAX_ID_FORMATS)).toHaveLength(23);
    for (const sinPatron of ["NI", "PA", "BZ"]) {
      expect(TAX_ID_FORMATS).not.toHaveProperty(sinPatron);
    }
  });
});

/**
 * F1-TAXID-04 — el dígito verificador donde el país lo define con un
 * algoritmo público: CUIT (AFIP, módulo 11 con pesos 5-4-3-2-7-6-5-4-3-2),
 * RUT (SII, módulo 11 con pesos cíclicos 2..7, `K` = 10) y CNPJ (Receita, dos
 * dígitos módulo 11). Un dígito cambiado rebota; el RFC no se toca.
 */
describe("el dígito verificador (F1-TAXID-04)", () => {
  it("Argentina: CUIT con verificador correcto pasa; con uno cambiado no", () => {
    expect(isTaxId("AR", "20-22222222-3")).toBe(true);
    expect(isTaxId("AR", "20-12345678-6")).toBe(true);
    expect(isTaxId("AR", "20-12345678-7")).toBe(false);
  });

  it("Chile: RUT con verificador correcto pasa (incluida la K); con uno cambiado no", () => {
    expect(isTaxId("CL", "11111111-1")).toBe(true);
    expect(isTaxId("CL", "76123456-0")).toBe(true);
    expect(isTaxId("CL", "76.123.456-7")).toBe(false);
    expect(isTaxId("CL", "11111111-K")).toBe(false);
  });

  it("Brasil: CNPJ con sus dos verificadores pasa; con uno cambiado no", () => {
    expect(isTaxId("BR", "11.222.333/0001-81")).toBe(true);
    expect(isTaxId("BR", "11222333000181")).toBe(true);
    expect(isTaxId("BR", "11.222.333/0001-82")).toBe(false);
  });

  it("México no verifica homoclave: un RFC bien formado pasa aunque sea inventado", () => {
    expect(isTaxId("MX", "ABC010101AB1")).toBe(true);
  });
});
