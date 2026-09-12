import { describe, expect, it } from "vitest";
import { normalizeCode } from "./code";

/**
 * Carlos (2026-09-12): los códigos de catálogo van SIEMPRE en mayúsculas. A
 * diferencia del lote, no se translitera ni se filtra: el negocio elige su
 * vocabulario y `REF.1234/A` es un código válido.
 */
describe("normalizeCode", () => {
  it("sube a mayúsculas y recorta", () => {
    expect(normalizeCode("  abc-01 ")).toBe("ABC-01");
  });

  it("conserva puntos, barras, guiones y acentos: el negocio eligió ese código", () => {
    expect(normalizeCode("ref.1234/a")).toBe("REF.1234/A");
    expect(normalizeCode("año-2026")).toBe("AÑO-2026");
  });

  it("colapsa el espacio interno a uno solo, sin quitarlo", () => {
    expect(normalizeCode("caja   grande")).toBe("CAJA GRANDE");
  });

  it("lo que ya está normalizado no cambia", () => {
    expect(normalizeCode("PROV-001")).toBe("PROV-001");
  });

  it("solo espacios queda vacío: el DTO lo rechaza con min(1)", () => {
    expect(normalizeCode("   ")).toBe("");
  });
});
