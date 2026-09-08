import { describe, expect, it } from "vitest";
import {
  ADDRESS_FORMATS,
  addressAsksRegion,
  addressRegionName,
  formatAddress,
  isAddressRegionCode,
  isPostalCode,
  MX_REGIONS,
  normalizePostalCode,
  resolveAddressFormat,
} from "./address";
import { TAX_CURATED_COUNTRIES } from "./tax-defaults";

/**
 * F1-ADDR-02. Los valores esperados de MX, US y CA son los del catálogo de
 * Google (libaddressinput) verificados el 2026-09-08: `fmt`, `require`, `zip`,
 * `state_name_type` y `sublocality_name_type`. Si el catálogo se copia mal,
 * estos tests lo dicen país por país.
 */
describe("resolveAddressFormat", () => {
  it("México: colonia en la línea 2, estado por nombre, CP de cinco dígitos y los cuatro obligatorios", () => {
    const mx = resolveAddressFormat("MX");
    expect(mx.line2).toBe("neighborhood");
    expect(mx.region).toBe("state");
    expect(mx.regionDisplay).toBe("name");
    expect(mx.postalCode).toBe("postalCode");
    expect(mx.postalCodeExample).toBe("02860");
    expect([...mx.required].sort()).toEqual(["city", "line1", "postalCode", "region"]);
  });

  it("Estados Unidos: unidad en la línea 2, estado por código, ZIP de 5 o 5+4", () => {
    const us = resolveAddressFormat("US");
    expect(us.line2).toBe("unit");
    expect(us.region).toBe("state");
    expect(us.regionDisplay).toBe("code");
    expect(us.postalCode).toBe("zip");
    expect([...us.required].sort()).toEqual(["city", "line1", "postalCode", "region"]);
  });

  it("Canadá: provincia por código y código postal A1A 1A1", () => {
    const ca = resolveAddressFormat("CA");
    expect(ca.line2).toBe("unit");
    expect(ca.region).toBe("province");
    expect(ca.regionDisplay).toBe("code");
    expect(ca.postalCode).toBe("postalCode");
    expect(ca.postalCodeExample).toBe("H3Z 2Y7");
    expect([...ca.required].sort()).toEqual(["city", "line1", "postalCode", "region"]);
  });

  it("los otros países curados NO piden región en esta versión, y por eso tampoco la exigen", () => {
    // España e Italia la tienen en su formato de Google (`ACSZ`), pero la
    // columna admite códigos de ocho caracteres y sus catálogos quedaron
    // pospuestos: pedirla como texto libre sería empezar la deuda.
    for (const country of ["ES", "IT", "GB", "AR", "BR"]) {
      expect(resolveAddressFormat(country).region).toBeNull();
      expect(resolveAddressFormat(country).required).not.toContain("region");
    }
    expect(resolveAddressFormat("ES").required).toContain("postalCode");
    expect([...resolveAddressFormat("AR").required].sort()).toEqual(["city", "line1"]);
  });

  it("sin país, o con uno no curado, el formato es el de hoy: solo la línea 1 obligatoria y sin regla de CP", () => {
    for (const country of [null, undefined, "JP", "mx"]) {
      const format = resolveAddressFormat(country);
      expect(format.required).toEqual(["line1"]);
      expect(format.postalCodePattern).toBeNull();
      expect(format.region).toBeNull();
    }
  });

  it("cubre exactamente los 26 países curados", () => {
    expect(Object.keys(ADDRESS_FORMATS).sort()).toEqual([...TAX_CURATED_COUNTRIES].sort());
  });
});

describe("addressAsksRegion", () => {
  it("solo México, Canadá y Estados Unidos", () => {
    for (const country of ["MX", "CA", "US"]) expect(addressAsksRegion(country)).toBe(true);
    for (const country of ["ES", "GB", "BR", null, undefined])
      expect(addressAsksRegion(country)).toBe(false);
  });
});

describe("normalizePostalCode", () => {
  it("Canadá: mayúsculas y el espacio en medio, se haya escrito como se haya escrito", () => {
    expect(normalizePostalCode("CA", "m5v3l9")).toBe("M5V 3L9");
    expect(normalizePostalCode("CA", " M5V 3L9 ")).toBe("M5V 3L9");
    expect(normalizePostalCode("CA", "m5v  3l9")).toBe("M5V 3L9");
  });

  it("el resto: recorta y pone en mayúsculas, sin inventar espacios", () => {
    expect(normalizePostalCode("MX", " 06000 ")).toBe("06000");
    expect(normalizePostalCode("GB", "ec1y 8sy")).toBe("EC1Y 8SY");
    expect(normalizePostalCode(null, "  abc ")).toBe("ABC");
  });
});

describe("isPostalCode", () => {
  it("México: cinco dígitos exactos", () => {
    expect(isPostalCode("MX", "06000")).toBe(true);
    expect(isPostalCode("MX", "0600")).toBe(false);
    expect(isPostalCode("MX", "06000-1")).toBe(false);
  });

  it("Estados Unidos: ZIP de cinco, o cinco más cuatro", () => {
    expect(isPostalCode("US", "78701")).toBe(true);
    expect(isPostalCode("US", "78701-1234")).toBe(true);
    expect(isPostalCode("US", "7870")).toBe(false);
  });

  it("Canadá: A1A 1A1, tolerando minúsculas y la falta de espacio porque primero se normaliza", () => {
    expect(isPostalCode("CA", "M5V 3L9")).toBe(true);
    expect(isPostalCode("CA", "M5V3L9")).toBe(true);
    expect(isPostalCode("CA", "m5v 3l9")).toBe(true);
    expect(isPostalCode("CA", "M5V 3L")).toBe(false);
    // La D no existe en los códigos postales canadienses.
    expect(isPostalCode("CA", "D1A 1A1")).toBe(false);
  });

  it("vacío nunca es inválido: que sea obligatorio lo decide `required`, no el patrón", () => {
    expect(isPostalCode("MX", "")).toBe(true);
    expect(isPostalCode("MX", "   ")).toBe(true);
  });

  it("sin país, o con uno sin patrón, todo vale", () => {
    expect(isPostalCode(null, "lo que sea")).toBe(true);
    expect(isPostalCode("JP", "100-0001")).toBe(true);
    expect(isPostalCode("PA", "cualquier cosa")).toBe(true);
  });
});

describe("regiones", () => {
  it("México tiene 32 estados con código ISO 3166-2 y nombre", () => {
    expect(MX_REGIONS).toHaveLength(32);
    expect(isAddressRegionCode("MX", "CMX")).toBe(true);
    expect(isAddressRegionCode("MX", "JAL")).toBe(true);
    expect(isAddressRegionCode("MX", "ON")).toBe(false);
    expect(addressRegionName("MX", "JAL")).toBe("Jalisco");
    expect(addressRegionName("MX", "CMX")).toBe("Ciudad de México");
  });

  it("Canadá y Estados Unidos siguen siendo los de F4-TAX", () => {
    expect(isAddressRegionCode("CA", "ON")).toBe(true);
    expect(isAddressRegionCode("US", "TX")).toBe(true);
    expect(isAddressRegionCode("US", "ON")).toBe(false);
    expect(addressRegionName("CA", "ON")).toBe("Ontario");
  });

  it("un país sin catálogo no acepta ninguna región", () => {
    expect(isAddressRegionCode("ES", "M")).toBe(false);
    expect(addressRegionName("ES", "M")).toBeUndefined();
  });
});

describe("formatAddress", () => {
  const completa = {
    line1: "Calle 5 #12",
    line2: "Col. Centro",
    city: "Ciudad de México",
    region: "CMX",
    postalCode: "06000",
  };

  it("México: calle, colonia, CP ciudad, estado por nombre", () => {
    expect(formatAddress(completa, "MX")).toBe(
      "Calle 5 #12, Col. Centro, 06000 Ciudad de México, Ciudad de México",
    );
  });

  it("Estados Unidos: calle, ciudad, estado por código y ZIP", () => {
    expect(
      formatAddress(
        { line1: "123 Main St", line2: null, city: "Austin", region: "TX", postalCode: "78701" },
        "US",
      ),
    ).toBe("123 Main St, Austin, TX 78701");
  });

  it("Canadá: calle, ciudad, provincia por código y código postal, sin coma entre ciudad y provincia", () => {
    expect(
      formatAddress(
        {
          line1: "123 Main St",
          line2: "Unit 4",
          city: "Toronto",
          region: "ON",
          postalCode: "M5V 3L9",
        },
        "CA",
      ),
    ).toBe("123 Main St, Unit 4, Toronto ON M5V 3L9");
  });

  it("la contraprueba: con solo la línea 1 devuelve la línea 1 tal cual — el ticket de hoy no cambia", () => {
    const soloTexto = {
      line1: "Calle 5 manzana 5, CDMX",
      line2: null,
      city: null,
      region: null,
      postalCode: null,
    };
    expect(formatAddress(soloTexto, "MX")).toBe("Calle 5 manzana 5, CDMX");
    expect(formatAddress(soloTexto, null)).toBe("Calle 5 manzana 5, CDMX");
  });

  it("los huecos no dejan separadores colgando", () => {
    // Sin CP ni colonia: «Calle 5 #12, Ciudad de México, Ciudad de México».
    expect(formatAddress({ ...completa, line2: null, postalCode: null }, "MX")).toBe(
      "Calle 5 #12, Ciudad de México, Ciudad de México",
    );
    // Sin ciudad en Estados Unidos: «123 Main St, TX 78701».
    expect(
      formatAddress(
        { line1: "123 Main St", line2: null, city: null, region: "TX", postalCode: "78701" },
        "US",
      ),
    ).toBe("123 Main St, TX 78701");
  });

  it("todo vacío es la cadena vacía, y sin país sigue el formato genérico", () => {
    expect(
      formatAddress({ line1: null, line2: null, city: null, region: null, postalCode: null }, "MX"),
    ).toBe("");
    expect(
      formatAddress(
        { line1: "Calle 5", line2: null, city: "Cochabamba", region: null, postalCode: null },
        "BO",
      ),
    ).toBe("Calle 5, Cochabamba");
  });
});
