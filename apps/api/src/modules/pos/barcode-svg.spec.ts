import { ticketBarcodeSvg } from "./barcode-svg";

/**
 * F4 — el código de barras del folio en el ticket (Carlos, 2026-08-24).
 *
 * Code-128 y no EAN/UPC a propósito: codifica alfanumérico, así que el folio
 * viaja COMPLETO («VTA-000009») y la pregunta de «¿qué pasa al llegar a
 * 999999?» desaparece — el folio crece a 7 dígitos y el código lo absorbe.
 * El escáner del POS ya lee `code_128` (FORMATOS_1D del barcode-scanner).
 */
describe("ticketBarcodeSvg", () => {
  it("devuelve un SVG", () => {
    const svg = ticketBarcodeSvg("VTA-000009");

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });

  it("folios distintos producen códigos distintos", () => {
    // Si dos folios dieran las mismas barras, el escaneo encontraría la venta
    // equivocada — que es peor que no encontrar ninguna.
    expect(ticketBarcodeSvg("VTA-000009")).not.toBe(ticketBarcodeSvg("VTA-000010"));
  });

  it("codifica también los folios largos: el contador no tiene techo", () => {
    // `VTA-1000000` (7 dígitos) es el folio real después del millón — está
    // testeado en folio.integration.spec. El código tiene que absorberlo.
    expect(ticketBarcodeSvg("VTA-1000000").startsWith("<svg")).toBe(true);
  });

  it("un folio vacío LANZA: un ticket sin folio es un bug, no un caso", () => {
    expect(() => ticketBarcodeSvg("")).toThrow();
  });
});
