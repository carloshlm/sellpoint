import { describe, expect, it } from "vitest";
import {
  FOLIO_PREFIXES,
  hasValidQuantityScale,
  INVENTORY_DOCUMENT_TYPES,
  MOVEMENT_REASONS,
  REASON_RULES,
  REASONS_BY_DIRECTION,
  RESERVED_FOLIO_PREFIXES,
  SELECTABLE_ENTRY_REASONS,
  SELECTABLE_EXIT_REASONS,
  TRANSFER_STALE_DAYS,
} from "./inventory";

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

describe("catálogo de motivos (F3-CORE-01)", () => {
  it("cada motivo vale en una dirección o en las dos, sin inventarse ninguna", () => {
    const todos = new Set([...REASONS_BY_DIRECTION.entry, ...REASONS_BY_DIRECTION.exit]);

    expect([...todos].sort()).toEqual([...MOVEMENT_REASONS].sort());
  });

  it("`physical_count` va en las dos direcciones: el conteo saca el teórico y mete lo contado", () => {
    expect(REASONS_BY_DIRECTION.entry).toContain("physical_count");
    expect(REASONS_BY_DIRECTION.exit).toContain("physical_count");
  });

  it("`transfer` también va en las dos: sale del origen y entra al destino", () => {
    expect(REASONS_BY_DIRECTION.entry).toContain("transfer");
    expect(REASONS_BY_DIRECTION.exit).toContain("transfer");
  });

  /**
   * Los motivos SELECCIONABLES son un subconjunto: `sale`/`sale_return` los
   * emite solo el POS de F4, `physical_count` solo la aprobación del conteo y
   * `transfer` en entrada solo la recepción. Un formulario que ofreciera
   * cualquiera de esos dejaría al usuario crear un movimiento que el API
   * rechaza con 422.
   */
  it("los motivos de formulario excluyen los que solo emite el sistema", () => {
    expect(SELECTABLE_ENTRY_REASONS).toEqual(["invoice", "adjustment", "customer_return"]);
    expect(SELECTABLE_EXIT_REASONS).toEqual([
      "adjustment",
      "transfer",
      "loss",
      "consumption",
      "expired",
    ]);

    for (const reserved of ["sale", "sale_return", "physical_count"] as const) {
      expect(SELECTABLE_ENTRY_REASONS).not.toContain(reserved);
      expect(SELECTABLE_EXIT_REASONS).not.toContain(reserved);
    }
  });

  it("todo motivo tiene sus reglas de campos, y ninguna regla sobra", () => {
    expect(Object.keys(REASON_RULES).sort()).toEqual([...MOVEMENT_REASONS].sort());
  });

  it("las reglas dicen lo que la tabla de convenciones prometió", () => {
    expect(REASON_RULES.invoice).toMatchObject({ requiresReference: true, requiresUnitCost: true });
    expect(REASON_RULES.adjustment).toMatchObject({ requiresNote: true });
    expect(REASON_RULES.consumption).toMatchObject({ requiresReference: true });
    expect(REASON_RULES.loss).toMatchObject({ requiresNote: true });
    expect(REASON_RULES.transfer).toMatchObject({ requiresLinkedWarehouse: true });
    // Los del sistema no le piden nada a nadie: no hay formulario detrás.
    expect(REASON_RULES.physical_count).toMatchObject({
      requiresReference: false,
      requiresNote: false,
      requiresUnitCost: false,
      requiresLinkedWarehouse: false,
    });
  });
});

describe("hasValidQuantityScale (F3-CORE-01)", () => {
  it("acepta hasta 4 decimales", () => {
    expect(hasValidQuantityScale(1)).toBe(true);
    expect(hasValidQuantityScale(0.5)).toBe(true);
    expect(hasValidQuantityScale(1.2345)).toBe(true);
  });

  it("rechaza el quinto decimal: la columna es DECIMAL(14,4) y lo redondearía en silencio", () => {
    expect(hasValidQuantityScale(1.00005)).toBe(false);
    expect(hasValidQuantityScale(1e-7)).toBe(false);
  });

  it("rechaza lo que no cabe en la columna y lo que no es un número", () => {
    expect(hasValidQuantityScale(10_000_000_000)).toBe(false);
    expect(hasValidQuantityScale(Number.NaN)).toBe(false);
    expect(hasValidQuantityScale(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("el traspaso se considera viejo a los 7 días", () => {
    expect(TRANSFER_STALE_DAYS).toBe(7);
  });
});
