import { distinctTaxGroupCodes, taxMarksFor } from "./ticket-tax-marks";

/**
 * F4-TAXMARK-01 — la letra de impuesto por línea. La CRA pide indicar el
 * estatus fiscal de cada línea cuando un ticket mezcla tratamientos; la
 * letra es de APARICIÓN (A, B, C) y no de las iniciales del componente,
 * porque en México los grupos de fábrica comparten el componente `VAT`.
 */
describe("taxMarksFor (F4-TAXMARK-01)", () => {
  it("Columbia Británica: dos grupos, dos letras por orden de aparición, con el nombre del grupo", () => {
    expect(
      taxMarksFor([
        { code: "GST_PST", name: "GST 5% + PST 7%" },
        { code: "GST", name: "GST 5%" },
      ]),
    ).toEqual([
      { code: "GST_PST", mark: "A", label: "GST 5% + PST 7%" },
      { code: "GST", mark: "B", label: "GST 5%" },
    ]);
  });

  it("México: tres grupos que comparten el componente VAT reciben tres letras distintas", () => {
    const marcas = taxMarksFor([
      { code: "VAT16", name: "IVA 16%" },
      { code: "VAT0", name: "IVA 0%" },
      { code: "EXEMPT", name: "Exento" },
    ]);
    expect(marcas.map((m) => m.mark)).toEqual(["A", "B", "C"]);
    expect(marcas[2]).toEqual({ code: "EXEMPT", mark: "C", label: "Exento" });
  });

  it("con un solo grupo no hay marcas: el papel no cambia", () => {
    expect(taxMarksFor([{ code: "VAT16", name: "IVA 16%" }])).toEqual([]);
    expect(taxMarksFor([])).toEqual([]);
  });

  it("el mismo código repetido es UNA marca, en el lugar donde apareció primero", () => {
    expect(
      taxMarksFor([
        { code: "HST", name: "HST 13%" },
        { code: "GST", name: "GST 5%" },
        { code: "HST", name: "HST 13%" },
      ]).map((m) => `${m.mark}=${m.code}`),
    ).toEqual(["A=HST", "B=GST"]);
  });
});

describe("distinctTaxGroupCodes", () => {
  it("los códigos distintos de las líneas, en orden de aparición y sin los nulos", () => {
    expect(
      distinctTaxGroupCodes([
        { taxGroupCode: "HST" },
        { taxGroupCode: null },
        { taxGroupCode: "GST" },
        { taxGroupCode: "HST" },
      ]),
    ).toEqual(["HST", "GST"]);
  });
});
