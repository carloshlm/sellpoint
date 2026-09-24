import type { Locale } from "@sellpoint/shared";
import {
  fechaCorta,
  TICKET_WIDTHS,
  type TicketWidth,
  type Translate,
} from "../pos/ticket.renderer";
import { ticketLogoNodes } from "../pos/ticket-logo";
import type { TicketLogoRender } from "../tenants/ticket-settings.service";

export interface TurnTicketInput {
  /** F4-TICKETCFG-06 — el logotipo ya resuelto y si el nombre del negocio se imprime. */
  logo: TicketLogoRender;
  showBusinessName: boolean;
  /**
   * F10-MANFIX-14 — solo el nombre del NEGOCIO, como arriba del ticket de
   * venta. El legal va junto al RFC, y este papel no lleva renglón del RFC:
   * no tiene dónde ir.
   */
  tenant: { name: string };
  number: number;
  customerName: string | null;
  createdAt: Date;
  /** La zona del negocio: el papel se lee ahí, no en UTC. */
  timeZone: string;
  locale: Locale;
  width: TicketWidth;
}

/**
 * El papel del turno (Carlos, 2026-09-02): la MISMA tira térmica del ticket
 * de venta (58 u 80 mm, alto automático), pero con una sola cosa que decir:
 * el número, en grande, para leerlo de lejos. Todo centrado.
 *
 * Función pura que devuelve el `docDefinition`, como el ticket del POS: se
 * testea qué dice el papel, no sus bytes.
 */
export function buildTurnTicketDefinition(input: TurnTicketInput, t: Translate) {
  const anchoMm = TICKET_WIDTHS[input.width];
  const anchoPt = anchoMm * 2.83;
  const margen = 5 * 2.83;
  const centrado = { alignment: "center" as const };

  return {
    pageSize: { width: anchoPt, height: "auto" },
    pageMargins: [margen, margen, margen, margen],
    defaultStyle: { font: "Helvetica", fontSize: 8, lineHeight: 1.1 },
    content: [
      ...ticketLogoNodes(input.logo, anchoPt - margen * 2),
      ...(input.showBusinessName ? [{ text: input.tenant.name, bold: true, ...centrado }] : []),
      linea(anchoPt - margen * 2),
      { text: t("ticket.turn"), fontSize: 10, ...centrado, margin: [0, 6, 0, 0] },
      // El número: el cliente lo lee desde la fila. Cabe en 48 mm hasta con
      // tres dígitos.
      { text: String(input.number), bold: true, fontSize: 56, ...centrado, margin: [0, 2, 0, 6] },
      ...(input.customerName ? [{ text: input.customerName, fontSize: 9, ...centrado }] : []),
      { text: fechaCorta(input.createdAt, input.locale, input.timeZone), fontSize: 7, ...centrado },
      linea(anchoPt - margen * 2),
      { text: t("ticket.turnFooter"), fontSize: 7, ...centrado, margin: [0, 4, 0, 0] },
    ],
  };
}

function linea(ancho: number) {
  return {
    canvas: [
      { type: "line", x1: 0, y1: 2, x2: ancho, y2: 2, lineWidth: 0.5, lineColor: "#999999" },
    ],
    margin: [0, 2, 0, 2],
  };
}
