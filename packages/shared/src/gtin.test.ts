import { describe, expect, it } from "vitest";
import { classifyGtin, gs1Prefix, gtinCheckDigit, gtinVariants, normalizeGtin14 } from "./gtin";

/**
 * F10-QUICKCAT-01 — los mismos valores que decide `gtin.py` al sembrar.
 *
 * Si alguna de estas expectativas cambia, el catálogo global queda partido en
 * dos: filas guardadas con una clave y consultas hechas con otra.
 */
describe("gtin", () => {
  it("el verificador se pondera desde el final, igual en toda longitud", () => {
    expect(gtinCheckDigit("7500001")).toBe(1);
    expect(gtinCheckDigit("750105530001")).toBe(3);
    expect(gtinCheckDigit("0000039")).toBe(0);
  });

  it("las cuatro escrituras de la misma lata dan una sola clave", () => {
    expect(normalizeGtin14("041500750903")).toBe("00041500750903");
    expect(normalizeGtin14("0041500750903")).toBe("00041500750903");
    expect(normalizeGtin14("00041500750903")).toBe("00041500750903");
    // Lo que manda el lector: con espacios y guiones de por medio.
    expect(normalizeGtin14(" 041500-750903 ")).toBe("00041500750903");
  });

  it("rechaza lo que no es un GTIN", () => {
    // Verificador que no cuadra: un dedazo en el último dígito.
    expect(normalizeGtin14("7501055300014")).toBeNull();
    // Longitud que no es de GTIN.
    expect(normalizeGtin14("750105530001")).toBeNull();
    expect(normalizeGtin14("0075000011")).toBeNull();
    // Puros ceros: relleno de un volcado, y pasa el módulo 10.
    expect(normalizeGtin14("00000000")).toBeNull();
    // Un SKU alfanumérico del negocio no es un código de barras.
    expect(normalizeGtin14("PARA-500")).toBeNull();
    expect(normalizeGtin14(null)).toBeNull();
    expect(normalizeGtin14("")).toBeNull();
  });

  it("el prefijo del EAN-8 sale de sus propios dígitos, no del relleno", () => {
    // El caso que justifica toda la función: leerle el prefijo al relleno
    // daría «000» (Estados Unidos) en vez de «750» (México).
    expect(classifyGtin("75000011")?.prefix).toBe("750");
    expect(gs1Prefix("00000075000011", 8)).toBe("750");
    expect(gs1Prefix("00000075000011", 13)).toBe("000");
  });

  it("el RCN-8 no tiene prefijo: es de la tienda, no del mundo", () => {
    // `00000390` es un producto en un supermercado y otro en el de enfrente.
    const rcn8 = classifyGtin("00000390");
    expect(rcn8?.gtin14).toBe("00000000000390");
    expect(rcn8?.prefix).toBeNull();
  });

  it("la etiqueta de báscula es válida para el negocio, con su prefijo aparte", () => {
    // `200`-`299` es circulación restringida: el prefijo existe, y es el JOIN
    // contra `gs1_prefix_ranges` el que le niega la entrada al catálogo.
    const bascula = classifyGtin("2000000000015");
    expect(bascula?.gtin14).toBe("02000000000015");
    expect(bascula?.prefix).toBe("200");
  });

  it("las variantes son las escrituras del mismo código, no otros códigos", () => {
    expect(gtinVariants("00041500750903")).toEqual([
      "00041500750903",
      "0041500750903",
      "041500750903",
    ]);
    // El EAN-13 mexicano no se puede escribir como UPC-A: el `7` se perdería.
    expect(gtinVariants("07501055300013")).toEqual(["07501055300013", "7501055300013"]);
  });

  it("clasificar entrega la clave, el prefijo y las variantes de una vez", () => {
    expect(classifyGtin("7501055300013")).toEqual({
      gtin14: "07501055300013",
      prefix: "750",
      variants: ["07501055300013", "7501055300013"],
    });
    expect(classifyGtin("no-es-un-codigo")).toBeNull();
  });
});
