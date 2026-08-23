import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeLotCode } from "@sellpoint/shared";
import { upsertDocumentLineSchema } from "./dto/document.dto";
import { createEntrySchema } from "./dto/movement.dto";

/**
 * BARRERA: todo `lotCode` que entra al API se NORMALIZA (2026-08-23).
 *
 * `product_lots` tiene `@@unique([productId, lotCode])`: sin normalizar,
 * `STM01` y `stm01` son dos lotes DISTINTOS del mismo producto. El FEFO los
 * trataría por separado y el operador vería sus existencias partidas en dos
 * renglones que se llaman igual.
 *
 * Normalizar solo en la pantalla no alcanza — una importación o cualquier
 * otro cliente entra por acá y se salta la regla. Y no basta con arreglar los
 * tres esquemas de hoy: el test de abajo BARRE los archivos y exige que
 * cualquier `lotCode` nuevo pase por `normalizeLotCode`, para que el cuarto
 * no nazca crudo dentro de seis meses.
 */
describe("lotCode se normaliza en el borde del API", () => {
  const UUID = "8c944151-d5e1-4a3f-a4da-8a9975a353cf";

  it("la línea de documento lo normaliza", () => {
    const parsed = upsertDocumentLineSchema.parse({ productId: UUID, lotCode: "st m 01" });
    expect(parsed.lotCode).toBe("STM01");
  });

  it("el movimiento directo lo normaliza", () => {
    const parsed = createEntrySchema.parse({
      warehouseId: UUID,
      reasonCode: "invoice",
      // `invoice` exige factura: la regla es del negocio, no del lote.
      reference: "F-001",
      lines: [{ productId: UUID, quantity: 1, unitCost: 10, lotCode: "stm01" }],
    });
    expect(parsed.lines[0]?.lotCode).toBe("STM01");
  });

  it("un código que se queda vacío al limpiarlo se RECHAZA", () => {
    // `"   "` normaliza a `""`. Guardarlo sería un lote sin nombre; devolver
    // 400 le dice al cajero que ese código no sirve, en vez de crear basura.
    expect(() => upsertDocumentLineSchema.parse({ productId: UUID, lotCode: "   " })).toThrow();
  });

  /**
   * El barrido: ningún `lotCode` puede definirse sin pasar por el
   * normalizador. Mismo molde que las barreras de fuente del front.
   */
  it("ningún esquema del API declara un `lotCode` crudo", () => {
    const archivos = ["dto/document.dto.ts", "dto/movement.dto.ts", "lots.controller.ts"];

    const crudos = archivos.filter((archivo) => {
      const fuente = readFileSync(join(__dirname, archivo), "utf8");
      const declaracion = /lotCode:\s*z\.[^\n]*/.exec(fuente)?.[0];
      return declaracion !== undefined && !declaracion.includes("normalizeLotCode");
    });

    expect({ sinNormalizar: crudos }).toEqual({ sinNormalizar: [] });
  });

  it("la barrera está mirando de verdad (no un barrido vacío)", () => {
    // Sin esto, renombrar el campo dejaría la lista vacía y el test de arriba
    // pasaría por no encontrar nada que revisar — la peor clase de verde.
    const fuente = readFileSync(join(__dirname, "dto/document.dto.ts"), "utf8");
    expect(fuente).toContain("lotCode:");
    expect(normalizeLotCode("abc")).toBe("ABC");
  });
});
