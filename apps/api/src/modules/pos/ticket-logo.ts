import { TICKET_LOGO_MAX_HEIGHT, TICKET_LOGO_MAX_WIDTH } from "@sellpoint/shared";
import type { TicketLogoRender } from "../tenants/ticket-settings.service";

/**
 * F4-TICKETCFG-05 — el logotipo arriba del papel, en pdfmake.
 *
 * El mismo nodo para el ticket de venta, la cotización y el turno: un preset
 * es un `svg` (el nodo con el que ya se dibuja el código de barras) y una
 * imagen propia es un `image` con su data URL. El ancho se DERIVA del papel
 * —40 % del ancho útil: ~19 mm en 58 mm, ~28 mm en 80 mm— y la altura se
 * limita en la misma proporción que el procesador (384×160), para que un
 * logotipo cuadrado no le robe media tira al contenido.
 */
export function ticketLogoNodes(logo: TicketLogoRender, anchoUtilPt: number): object[] {
  if (logo === null) {
    return [];
  }
  const width = Math.round(anchoUtilPt * 0.4);
  const maxHeight = Math.round((width * TICKET_LOGO_MAX_HEIGHT) / TICKET_LOGO_MAX_WIDTH);
  const comun = { alignment: "center" as const, margin: [0, 0, 0, 6] };
  if ("svg" in logo) {
    return [{ svg: logo.svg, width, ...comun }];
  }
  return [{ image: logo.dataUrl, fit: [width, maxHeight], ...comun }];
}
