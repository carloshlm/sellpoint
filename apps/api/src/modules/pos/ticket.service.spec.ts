import { descripcionDeFila } from "./ticket.service";

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
