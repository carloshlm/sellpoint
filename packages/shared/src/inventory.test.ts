import { describe, expect, it } from "vitest";
import { FOLIO_PREFIXES, INVENTORY_DOCUMENT_TYPES, RESERVED_FOLIO_PREFIXES } from "./inventory";

/**
 * F3-DOC-03 — el contrato de las series de folio.
 *
 * Mismo molde que `UNITS` contra la tabla `units`: la fuente vive en shared y
 * un test la fija, para que agregar un tipo de documento sin darle prefijo
 * falle acá y no en producción con un folio `undefined-000001`.
 */
describe("FOLIO_PREFIXES", () => {
  it("todo tipo de documento tiene su serie", () => {
    for (const type of INVENTORY_DOCUMENT_TYPES) {
      expect(FOLIO_PREFIXES[type]).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("son exactamente tres, las que decidió Carlos el 2026-08-18", () => {
    expect(FOLIO_PREFIXES).toEqual({ entry: "ENT", exit: "SAL", physical_count: "INV" });
  });

  /**
   * Dos tipos compartiendo prefijo romperían la unicidad `(tenant, folio)`:
   * la serie es por `key`, así que dos keys distintas llegarían al mismo
   * número con el mismo prefijo.
   */
  it("ningún prefijo se repite entre tipos", () => {
    const prefijos = Object.values(FOLIO_PREFIXES);
    expect(new Set(prefijos).size).toBe(prefijos.length);
  });

  it("`VTA` queda reservada para el POS de F4 y nadie la usa todavía", () => {
    expect(RESERVED_FOLIO_PREFIXES).toContain("VTA");
    expect(Object.values(FOLIO_PREFIXES)).not.toContain("VTA");
  });

  it("un traspaso NO tiene serie propia: es una salida con motivo", () => {
    const todos = [...Object.values(FOLIO_PREFIXES), ...RESERVED_FOLIO_PREFIXES];
    expect(todos).not.toContain("TRA");
    expect(todos).not.toContain("REC");
  });
});
