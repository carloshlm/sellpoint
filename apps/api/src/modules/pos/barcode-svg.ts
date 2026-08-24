import bwipjs from "bwip-js";

/**
 * El código de barras del folio para el ticket (Carlos, 2026-08-24).
 *
 * **Code-128, no EAN/UPC**: codifica alfanumérico, así que el folio viaja
 * COMPLETO («VTA-000009»). Eso disuelve la pregunta de «¿qué hacemos al llegar
 * a 999999?» — el folio crece a `VTA-1000000` (comportamiento ya testeado en
 * `folio.integration.spec.ts`) y el código lo absorbe sin tope. Un esquema
 * numérico con reinicio habría chocado con `@@unique([tenantId, folio])` y
 * vuelto ambiguo el `reference` del kardex.
 *
 * El escáner del POS ya lee `code_128` (FORMATOS_1D de `barcode-scanner.tsx`),
 * y una pistola USB también: son alfanuméricos de fábrica.
 *
 * `toSVG` es síncrono y JS puro (sin binarios nativos): encaja en el renderer
 * PURO del ticket sin volverlo async. Sin `includetext` — el folio ya sale
 * impreso arriba del ticket y repetirlo debajo de las barras es ruido.
 */
export function folioBarcodeSvg(folio: string): string {
  // Sin guarda propia contra el folio vacío A PROPÓSITO: bwip-js ya lanza
  // («bar code text not specified»), y una contraprueba demostró que la
  // guarda duplicada era código muerto — quitarla dejaba el spec en verde.
  // El contrato (vacío lanza) lo fija el spec contra el comportamiento real.
  return bwipjs.toSVG({
    bcid: "code128",
    text: folio,
    height: 10,
    includetext: false,
  });
}
