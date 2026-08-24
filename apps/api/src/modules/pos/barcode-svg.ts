import bwipjs from "bwip-js";

/**
 * Las barras Code-128 de un texto del ticket (folio o código diario).
 *
 * **Code-128 para los dos contenidos**: alfanumérico para los folios
 * (`VTA-000009`, `COT-000003`) y modo C compacto cuando el texto es numérico
 * puro — el código diario de 12 dígitos (`202608240045`). El escáner del POS
 * ya lo lee (`code_128` en FORMATOS_1D de `barcode-scanner.tsx`) y una
 * pistola USB también.
 *
 * **El código diario SÍ reinicia y el folio NO**, y no es contradicción: son
 * campos distintos. El folio es la identidad contable —único por tenant para
 * siempre, referenciado por el kardex— y reiniciarlo chocaría con
 * `@@unique([tenantId, folio])`. El código diario lleva la fecha adentro
 * (`YYYYMMDD` + consecutivo), así que cada día es una serie nueva y la
 * unicidad es estructural (decisión de Carlos, 2026-08-24).
 *
 * `toSVG` es síncrono y JS puro (sin binarios nativos): encaja en el renderer
 * PURO del ticket sin volverlo async. Sin `includetext` — el número visible
 * se pinta como nodo de TEXTO de pdfmake, para que el papel tenga una sola
 * tipografía (Helvetica) en vez de la fuente interna de bwip.
 */
export function ticketBarcodeSvg(text: string): string {
  // Sin guarda propia contra el texto vacío A PROPÓSITO: bwip-js ya lanza
  // («bar code text not specified»), y una contraprueba demostró que la
  // guarda duplicada era código muerto. El contrato lo fija el spec.
  return bwipjs.toSVG({
    bcid: "code128",
    text,
    height: 10,
    includetext: false,
  });
}
