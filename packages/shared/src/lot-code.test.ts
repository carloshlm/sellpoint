import { describe, expect, it } from "vitest";
import { normalizeLotCode } from "./lot-code";

/**
 * El código de lote se normaliza en UN solo lugar (2026-08-23).
 *
 * **Por qué no alcanza con limpiar el input**: `product_lots` tiene
 * `@@unique([productId, lotCode])`, así que `STM01` y `stm01` serían dos
 * lotes DISTINTOS del mismo producto — el FEFO los trataría por separado y el
 * operador vería el mismo lote duplicado. Si la regla vive solo en la
 * pantalla, cualquier otro camino al API (una importación, otro cliente) la
 * salta y ensucia los datos. Por eso esta función se usa en los dos lados.
 */
describe("normalizeLotCode", () => {
  it("sube a mayúsculas", () => {
    expect(normalizeLotCode("stm01")).toBe("STM01");
  });

  it("descarta espacios y símbolos, pero CONSERVA el guion", () => {
    // Un espacio de más partiría el mismo lote en dos según cómo lo teclee
    // cada cajero. El guion no: es parte del código que trae el proveedor
    // (`L-0001`), y borrarlo dejaría el sistema sin coincidir con la caja.
    expect(normalizeLotCode("st-m 01")).toBe("ST-M01");
    expect(normalizeLotCode("L/2026#01")).toBe("L202601");
    expect(normalizeLotCode("l-0001")).toBe("L-0001");
  });

  it("quita los acentos en vez de comerse la letra", () => {
    // `Ñ` y las vocales acentuadas no son [A-Z0-9]: borrarlas dejaría "AO"
    // donde el proveedor escribió "AÑO". Se transliteran.
    expect(normalizeLotCode("año1")).toBe("ANO1");
    expect(normalizeLotCode("café")).toBe("CAFE");
  });

  it("un código que ya está bien no cambia", () => {
    expect(normalizeLotCode("STM01")).toBe("STM01");
  });

  it("lo que queda vacío se devuelve vacío, no se inventa nada", () => {
    expect(normalizeLotCode("   ")).toBe("");
    // Los guiones SÍ sobreviven; lo que se va son espacios y símbolos.
    expect(normalizeLotCode("- -")).toBe("--");
  });
});
