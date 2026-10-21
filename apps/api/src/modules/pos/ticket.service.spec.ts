import { anotacionesDelTicket, descripcionDeFila } from "./ticket.service";

/**
 * F4-CONCEPT-07 — qué dice el renglón del ticket.
 *
 * La `description` de la cotización gana (es lo que decía el papel); la venta
 * no la tiene y cae al nombre vigente del catálogo… salvo el concepto, que no
 * tiene catálogo: su texto vive en la fila (`concept_description`).
 */
describe("descripcionDeFila", () => {
  it("un concepto de una venta imprime su descripción, no un renglón vacío", () => {
    expect(
      descripcionDeFila(
        { description: undefined, conceptDescription: "Flete a domicilio" },
        undefined,
        undefined,
      ),
    ).toBe("Flete a domicilio");
  });

  it("la descripción de la cotización gana sobre el nombre vigente", () => {
    expect(
      descripcionDeFila(
        { description: "Agua — Pieza", conceptDescription: null },
        { name: "Agua mineral" },
        undefined,
      ),
    ).toBe("Agua — Pieza");
  });

  it("sin descripción cae al producto o al servicio, y al final a vacío", () => {
    expect(descripcionDeFila({}, { name: "Agua" }, undefined)).toBe("Agua");
    expect(descripcionDeFila({}, undefined, { name: "Consulta" })).toBe("Consulta");
    expect(descripcionDeFila({}, undefined, undefined)).toBe("");
  });
});

/**
 * F9-RECEP-24 — lo que se lee de `sales.annotations` para imprimirlo. Viene de
 * un JSONB: si alguna vez trajera algo que no es una anotación válida, la
 * reimpresión NO se cae; simplemente no imprime anotaciones.
 */
describe("anotacionesDelTicket", () => {
  const turno = {
    sourceModule: "reception",
    labelKey: "reception.saleAnnotation.turn",
    value: "7",
    emphasis: true,
  };

  it("las anotaciones guardadas llegan al papel, sin el módulo que las firmó", () => {
    expect(anotacionesDelTicket([turno])).toEqual([
      { labelKey: "reception.saleAnnotation.turn", value: "7", emphasis: true },
    ]);
  });

  it("sin anotaciones, o con algo que no lo es, no hay nada que imprimir", () => {
    expect(anotacionesDelTicket([])).toEqual([]);
    expect(anotacionesDelTicket(null)).toEqual([]);
    expect(anotacionesDelTicket({ turno: 7 })).toEqual([]);
    expect(anotacionesDelTicket([{ ...turno, labelKey: "Turno 7" }])).toEqual([]);
  });
});
