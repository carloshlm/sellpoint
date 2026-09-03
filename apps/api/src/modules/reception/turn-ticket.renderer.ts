import type { Locale } from "@sellpoint/shared";
import { TICKET_WIDTHS, type TicketWidth, type Translate } from "../pos/ticket.renderer";

export interface TurnTicketInput {
  tenant: { name: string; legalName: string | null };
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
      { text: input.tenant.legalName ?? input.tenant.name, bold: true, ...centrado },
      linea(anchoPt - margen * 2),
      { text: t("ticket.turn"), fontSize: 10, ...centrado, margin: [0, 6, 0, 0] },
      // El número: el cliente lo lee desde la fila. Cabe en 48 mm hasta con
      // tres dígitos.
      { text: String(input.number), bold: true, fontSize: 56, ...centrado, margin: [0, 2, 0, 6] },
      ...(input.customerName ? [{ text: input.customerName, fontSize: 9, ...centrado }] : []),
      { text: fechaYHora(input.createdAt, input.locale, input.timeZone), fontSize: 7, ...centrado },
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

/** Fecha y hora en la zona del NEGOCIO: un turno se lee el mismo día, ahí. */
function fechaYHora(value: Date, locale: Locale, timeZone: string): string {
  const opciones: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      ...opciones,
      timeZone,
    }).format(value);
  } catch {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", opciones).format(value);
  }
}
