import {
  type Currency,
  formatMoney,
  formatQuantityWithUnit,
  type Locale,
  type TicketSettings,
} from "@sellpoint/shared";
import type { TicketLogoRender } from "../tenants/ticket-settings.service";
import { ticketBarcodeSvg } from "./barcode-svg";
import type { TicketHeaderContact } from "./ticket-header";
import { ticketLogoNodes } from "./ticket-logo";

/** Traduce una clave; lo inyecta el service con el locale del usuario. */
export type Translate = (key: string) => string;

/** Los dos anchos de papel térmico del mercado. */
export const TICKET_WIDTHS = { "58mm": 58, "80mm": 80 } as const;
export type TicketWidth = keyof typeof TICKET_WIDTHS;

export interface TicketRow {
  /** Lo que se cotizó o vendió, en texto. */
  description: string;
  quantity: string;
  /** La unidad BASE del producto. `null` en un servicio: no sale del anaquel. */
  baseUnit: string | null;
  unitPrice: string;
  lineTotal: string;
  /** El lote que FEFO eligió, si el producto los lleva. */
  lotCode: string | null;
}

/** `=== null` a secas trataría "" como texto imprimible: línea vacía en papel. */
function noVacio(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

export interface TicketInput {
  tenant: { name: string; legalName: string | null; taxId: string | null };
  /**
   * El contacto que se imprime bajo la razón social (2026-08-26): dirección
   * y teléfono del ALMACÉN con fallback al tenant, YA colapsados por el
   * service (ticketHeaderContact) — este renderer no decide, pinta.
   */
  header: TicketHeaderContact;
  /**
   * `sale` imprime el ticket que el cliente se lleva; `quote` el papel con el
   * que vuelve. Es lo único que decide qué se muestra y qué se advierte.
   */
  kind: "sale" | "quote";
  folio: string;
  createdAt: Date;
  sellerName: string;
  warehouseName: string;
  rows: TicketRow[];
  subtotal: string;
  discount: string;
  total: string;
  /**
   * El código de barras diario del ticket (`202608240045`). Solo en ventas
   * nuevas: `null` en las anteriores a la migración y en cotizaciones — esos
   * papeles caen a las barras del folio.
   */
  barcode?: string | null;
  /** Solo en la venta. */
  paymentMethod?: string | null;
  received?: string | null;
  change?: string | null;
  note?: string | null;
  currency: Currency;
  locale: Locale;
  width: TicketWidth;
  /**
   * F4-TICKETCFG-05 — qué del negocio se imprime y el pie. Los toggles solo
   * deciden si SALE lo que ya se resolvió arriba; el renderer no lee nada.
   */
  settings: TicketSettings;
  /** El logotipo ya resuelto por el service (SVG del preset o data URL). */
  logo: TicketLogoRender;
}

/**
 * F4-TICKET-01 — el papel que el cliente se lleva.
 *
 * ── Por qué NO se reusa el renderer de documentos ───────────────────────
 *
 * El de F3 es una hoja carta con firmas, costos de compra y un cuadro de
 * autorización. Este es una tira de 58 u 80 mm con precios de venta y sin un
 * solo lugar donde firmar. Compartirlos habría significado un archivo lleno de
 * `if (esTicket)` en cada bloque — dos documentos distintos disfrazados de uno.
 *
 * **Lo que sí se comparte es lo que importa**: el patrón de función pura que
 * devuelve el `docDefinition` en vez de un binario —para poder testear QUÉ
 * dice el papel en lugar de comparar bytes—, el printer y el transporte.
 *
 * ── pdfmake sigue en 0.2.x A PROPÓSITO ──────────────────────────────────
 *
 * La 0.3 rompe la DI del módulo (`pdfmake_1.default is not a constructor`,
 * bitácora 2026-08-19) y por eso está excluida del grupo de Dependabot. Este
 * archivo no la actualiza ni la necesita.
 *
 * ── Una tira, no una página ─────────────────────────────────────────────
 *
 * `pageSize` con alto `auto`: un ticket de tres líneas no puede salir con
 * treinta centímetros de papel en blanco abajo, que es lo que pasa si se le da
 * un alto fijo. Los márgenes son mínimos porque el área imprimible de una
 * térmica de 58 mm son ~48.
 */
export function buildTicketDefinition(input: TicketInput, t: Translate) {
  const anchoMm = TICKET_WIDTHS[input.width];
  // 1 mm ≈ 2.83 pt. La térmica no imprime hasta el borde: 5 mm de margen por
  // lado es lo que reconoce cualquier cabezal del mercado.
  const anchoPt = anchoMm * 2.83;
  const margen = 5 * 2.83;

  const dinero = (valor: string | null | undefined): string =>
    formatMoney(Number(valor ?? 0), input.currency, input.locale);

  const esCotizacion = input.kind === "quote";

  return {
    pageSize: { width: anchoPt, height: "auto" },
    pageMargins: [margen, margen, margen, margen],
    defaultStyle: { font: "Helvetica", fontSize: 8, lineHeight: 1.1 },
    content: [
      // ── El logotipo, arriba de todo (F4-TICKETCFG-05) ─────────────────
      ...ticketLogoNodes(input.logo, anchoPt - margen * 2),

      // ── Quién cobra: cada línea solo con su toggle ────────────────────
      ...(input.settings.showBusinessName
        ? [{ text: input.tenant.legalName ?? input.tenant.name, bold: true, alignment: "center" }]
        : []),
      ...(input.settings.showTaxId && noVacio(input.tenant.taxId)
        ? [{ text: input.tenant.taxId, alignment: "center", fontSize: 7 }]
        : []),
      ...(input.settings.showAddress && noVacio(input.header.address)
        ? [{ text: input.header.address, alignment: "center", fontSize: 7 }]
        : []),
      ...(input.settings.showPhone && noVacio(input.header.phone)
        ? [
            {
              text: `${t("ticket.phone")}: ${input.header.phone}`,
              alignment: "center",
              fontSize: 7,
            },
          ]
        : []),

      // ── La MARCA de cotización ────────────────────────────────────────
      //
      // Decisión de Carlos: una cotización tiene que verse distinta de un
      // ticket de un vistazo. Sin esto, el cliente vuelve con un papel que
      // parece un comprobante de pago por algo que nunca pagó.
      ...(esCotizacion
        ? [
            {
              text: t("ticket.quoteMark"),
              bold: true,
              alignment: "center",
              margin: [0, 4, 0, 0],
            },
          ]
        : []),

      { text: input.folio, bold: true, alignment: "center", margin: [0, 4, 0, 2] },
      {
        // El almacén va en la línea de la fecha solo si el negocio lo quiere.
        text: input.settings.showWarehouse
          ? `${fechaCorta(input.createdAt, input.locale)}  ·  ${input.warehouseName}`
          : fechaCorta(input.createdAt, input.locale),
        alignment: "center",
        fontSize: 7,
      },
      { text: `${t("ticket.seller")}: ${input.sellerName}`, fontSize: 7, margin: [0, 0, 0, 4] },

      linea(anchoPt - margen * 2),

      // ── Las líneas ────────────────────────────────────────────────────
      //
      // Cada una en DOS renglones y no en una tabla de columnas: en 48 mm de
      // ancho, un nombre de producto real no entra al lado de tres números.
      // Partirlo deja el nombre completo arriba y la aritmética abajo.
      ...input.rows.flatMap((row) => [
        { text: row.description, margin: [0, 2, 0, 0] },
        {
          columns: [
            {
              // La unidad se NOMBRA y la cantidad se formatea según su
              // categoría — nunca el código crudo ni un `.0000` en piezas
              // (lecciones del 2026-08-20).
              text: `${cantidadLegible(row, input.locale)} × ${dinero(row.unitPrice)}`,
              fontSize: 7,
            },
            { text: dinero(row.lineTotal), alignment: "right", fontSize: 7 },
          ],
        },
        ...(row.lotCode === null
          ? []
          : [{ text: `${t("ticket.lot")}: ${row.lotCode}`, fontSize: 6, color: "#666666" }]),
      ]),

      linea(anchoPt - margen * 2),

      // ── Los totales ───────────────────────────────────────────────────
      ...(Number(input.discount) > 0
        ? [
            fila(t("ticket.subtotal"), dinero(input.subtotal)),
            fila(t("ticket.discount"), `-${dinero(input.discount)}`),
          ]
        : []),
      {
        columns: [
          { text: t("ticket.total"), bold: true },
          { text: dinero(input.total), alignment: "right", bold: true },
        ],
        margin: [0, 2, 0, 2],
      },

      // ── El cobro, solo en la venta ────────────────────────────────────
      ...(esCotizacion
        ? []
        : [
            ...(input.paymentMethod == null
              ? []
              : [fila(t("ticket.payment"), t(`ticket.method.${input.paymentMethod}`))]),
            ...(input.received == null ? [] : [fila(t("ticket.received"), dinero(input.received))]),
            ...(input.change == null ? [] : [fila(t("ticket.change"), dinero(input.change))]),
          ]),

      ...(input.note == null || input.note === ""
        ? []
        : [{ text: input.note, fontSize: 7, margin: [0, 4, 0, 0] }]),

      // ── El pie ────────────────────────────────────────────────────────
      //
      // La leyenda de la cotización es una DECISIÓN de negocio, no cortesía:
      // los precios no se congelan (F4-QUOTE-02), así que el papel tiene que
      // decir que el final se calcula en caja. Sin eso, el cliente vuelve en un
      // mes reclamando un número que el sistema ya no reconoce.
      //
      // El mensaje propio del negocio (F4-TICKETCFG-05) reemplaza al de
      // fábrica en la venta; en la cotización se SUMA a la leyenda, que no se
      // apaga con nada.
      ...(esCotizacion
        ? [
            {
              text: t("ticket.quoteDisclaimer"),
              alignment: "center",
              fontSize: 7,
              margin: [0, 6, 0, 0],
            },
            ...(input.settings.footerMessage === null
              ? []
              : [
                  {
                    text: input.settings.footerMessage,
                    alignment: "center",
                    fontSize: 7,
                    margin: [0, 2, 0, 0],
                  },
                ]),
          ]
        : [
            {
              text: input.settings.footerMessage ?? t("ticket.thanks"),
              alignment: "center",
              fontSize: 7,
              margin: [0, 6, 0, 0],
            },
          ]),

      // ── El código de barras del papel (Carlos, 2026-08-24) ────────────
      // La venta nueva trae su código DIARIO de 12 dígitos y lo pinta con el
      // número VISIBLE debajo (nodo de texto, no `includetext`: una sola
      // tipografía en el papel). La venta vieja y la cotización caen a las
      // barras del FOLIO — escanear una cotización en el carrito la carga a
      // la venta, y un folio se resuelve en el buscador del historial. El
      // ancho se DERIVA del papel: nada de anchos fijos en 58 mm.
      {
        svg: ticketBarcodeSvg(input.barcode ?? input.folio),
        width: anchoPt - margen * 2,
        alignment: "center",
        margin: [0, 8, 0, 0],
      },
      ...(input.barcode == null
        ? []
        : [
            {
              text: input.barcode,
              alignment: "center",
              fontSize: 7,
              margin: [0, 2, 0, 0],
            },
          ]),
    ],
  };
}

/** Una regla de punto a punto: un `canvas` pesa menos que una fila de guiones. */
function linea(ancho: number) {
  return {
    canvas: [
      { type: "line", x1: 0, y1: 2, x2: ancho, y2: 2, lineWidth: 0.5, lineColor: "#999999" },
    ],
    margin: [0, 2, 0, 2],
  };
}

function fila(label: string, valor: string) {
  return { columns: [{ text: label }, { text: valor, alignment: "right" }] };
}

/**
 * `2 piezas`, `0.500 kilogramos`, o solo `2` en un servicio.
 *
 * Un servicio no tiene unidad base porque no sale del anaquel: imprimirle
 * «piezas» sería inventar una medida que nadie definió.
 */
function cantidadLegible(row: TicketRow, locale: Locale): string {
  if (row.baseUnit === null) {
    return row.quantity;
  }
  return formatQuantityWithUnit(row.quantity, row.baseUnit, locale);
}

/** Fecha corta en la zona del usuario: un ticket se lee el mismo día. */
function fechaCorta(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}
