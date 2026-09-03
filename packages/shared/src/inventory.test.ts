import { describe, expect, it } from "vitest";
import {
  ALL_FOLIO_PREFIXES,
  FOLIO_PREFIXES,
  hasValidQuantityScale,
  INVENTORY_DOCUMENT_TYPES,
  MEDICAL_CLINIC_FOLIO_PREFIXES,
  MOVEMENT_REASONS,
  POS_FOLIO_PREFIXES,
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

  it("las de INVENTARIO son exactamente tres, las que decidió Carlos el 2026-08-18", () => {
    expect(FOLIO_PREFIXES).toEqual({ entry: "ENT", exit: "SAL", physical_count: "INV" });
  });

  /**
   * `VTA` y `COT` van APARTE y no dentro de `FOLIO_PREFIXES`: aquella está
   * tipada por `InventoryDocumentType`, y una venta no es un documento de
   * inventario — vive en `sales`, no en `inventory_documents`.
   */
  it("las del POS son dos, y viven aparte de las de inventario (F4-DB-03)", () => {
    expect(POS_FOLIO_PREFIXES).toEqual({ sale: "VTA", quote: "COT" });
    expect(Object.values(FOLIO_PREFIXES)).not.toContain("VTA");
    expect(Object.values(FOLIO_PREFIXES)).not.toContain("COT");
  });

  /**
   * Dos tipos compartiendo prefijo romperían la unicidad `(tenant, folio)`:
   * la serie es por `key`, así que dos keys distintas llegarían al mismo
   * número con el mismo prefijo.
   */
  /** F9-CLINIC-01: el expediente (`HCL`) y la orden sin cobro (`ORM`). */
  it("las del consultorio son dos y entran en el catálogo de series", () => {
    expect(MEDICAL_CLINIC_FOLIO_PREFIXES).toEqual({ record: "HCL", order: "ORM" });
    expect(ALL_FOLIO_PREFIXES).toContain("HCL");
    expect(ALL_FOLIO_PREFIXES).toContain("ORM");
  });

  it("ningún prefijo se repite entre series, ni con las reservadas", () => {
    const todos = [...ALL_FOLIO_PREFIXES, ...RESERVED_FOLIO_PREFIXES];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("todas las series son de tres letras mayúsculas", () => {
    for (const prefijo of ALL_FOLIO_PREFIXES) {
      expect(prefijo).toMatch(/^[A-Z]{3}$/);
    }
  });

  /**
   * `VTA` estuvo reservada desde F3 y F4-DB-03 la puso en uso, así que la
   * lista quedó vacía. El test sobrevive porque la invariante no era «VTA está
   * reservada» sino **«lo reservado no se usa»** — la próxima fase que aparte
   * una serie la hereda sin escribir nada.
   */
  it("lo RESERVADO no está en uso (hoy la lista está vacía)", () => {
    for (const reservado of RESERVED_FOLIO_PREFIXES) {
      expect(ALL_FOLIO_PREFIXES).not.toContain(reservado);
    }
  });

  it("un traspaso NO tiene serie propia: es una salida con motivo", () => {
    const todos = [...ALL_FOLIO_PREFIXES, ...RESERVED_FOLIO_PREFIXES];
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
