import type { PaymentMethod } from "@sellpoint/shared";
import { api } from "@/lib/api";
import { dispararDescarga } from "@/lib/download";

export interface CashboxSession {
  id: string;
  warehouseId: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  declaredCash: string | null;
  calculatedCash: string | null;
  cashDifference: string | null;
  closingNote: string | null;
  warehouse: { id: string; name: string };
}

/** Lo vendido por método en el turno. `total` es string decimal, como todo el dinero del API. */
export interface SessionTotal {
  method: PaymentMethod;
  total: string;
  count: number;
}

export async function getSession(): Promise<{ session: CashboxSession | null }> {
  const { data } = await api.get<{ session: CashboxSession | null }>("/pos/session");
  return data;
}

export async function openSession(warehouseId?: string): Promise<CashboxSession> {
  const { data } = await api.post<CashboxSession>(
    "/pos/session",
    warehouseId === undefined ? {} : { warehouseId },
  );
  return data;
}

export async function getSessionTotals(): Promise<{ totals: SessionTotal[] }> {
  const { data } = await api.get<{ totals: SessionTotal[] }>("/pos/session/totals");
  return data;
}

export async function closeSession(input: {
  declaredCash: number;
  note?: string;
}): Promise<{ session: CashboxSession; totals: SessionTotal[] }> {
  const { data } = await api.post<{ session: CashboxSession; totals: SessionTotal[] }>(
    "/pos/session/close",
    input,
  );
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// F4-CART-01 — el buscador
// ─────────────────────────────────────────────────────────────────────────

export type LookupKind = "barcode" | "sku" | "text" | "service" | "quote";

/** Una presentación vendible. `factor` y `price` son strings decimales. */
export interface LookupPresentation {
  id: string;
  name: string;
  factor: string;
  price: string | null;
  barcode: string | null;
  isDefaultSale: boolean;
  /** Del server, derivado de la categoría de la unidad. El numpad lo obedece. */
  allowFractionalInput: boolean;
}

export interface LookupProductItem {
  type: "product";
  matchedBy: LookupKind;
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  isComposite: boolean;
  /** Vendible en el almacén del turno, en unidad BASE. */
  available: string;
  /** Lo que hay pero está vencido: sin este dato, "no hay" mentiría. */
  expired: string;
  presentations: LookupPresentation[];
  /** Cuál presentación llevaba el código escaneado. El carrito la preselecciona. */
  matchedPresentationId: string | null;
}

export interface LookupServiceItem {
  type: "service";
  matchedBy: LookupKind;
  id: string;
  code: string;
  name: string;
  price: string | null;
}

export interface LookupQuoteItem {
  type: "quote";
  matchedBy: LookupKind;
  id: string;
  folio: string;
  status: "open" | "loaded" | "canceled";
  total: string;
  lineCount: number;
}

export type LookupItem = LookupProductItem | LookupServiceItem | LookupQuoteItem;

export interface LookupResult {
  warehouseId: string;
  /**
   * `true` cuando respondió una strategy exacta (código, SKU o folio). La
   * pantalla lo usa para mandar el acierto derecho al carrito en vez de abrir
   * una lista de un solo renglón.
   */
  exact: boolean;
  items: LookupItem[];
}

export async function lookup(q: string, warehouseId?: string): Promise<LookupResult> {
  const { data } = await api.get<LookupResult>("/pos/lookup", {
    params: { q, ...(warehouseId !== undefined && { warehouseId }) },
  });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// F4-UI-02 — el cobro
// ─────────────────────────────────────────────────────────────────────────

export interface SaleItem {
  id: string;
  lineNo: number;
  productId: string | null;
  serviceId: string | null;
  presentationId: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

export interface Sale {
  id: string;
  folio: string;
  /**
   * El código del ticket: `YYYYMMDD` + consecutivo diario de 4 dígitos.
   * Nulo en las ventas anteriores al cambio (2026-08-24) — no se
   * backfillearon a propósito, así que la UI tiene que tolerar el hueco.
   */
  barcode: string | null;
  warehouseId: string;
  status: "completed" | "canceled";
  paymentMethod: PaymentMethod;
  subtotal: string;
  discount: string;
  total: string;
  createdAt: string;
  items: SaleItem[];
}

export interface CreateSaleInput {
  paymentMethod: PaymentMethod;
  lines: { productId?: string; serviceId?: string; presentationId?: string; quantity: number }[];
  quoteId?: string;
}

/**
 * El cobro.
 *
 * `idempotencyKey` se genera al ABRIR el modal, no al hacer clic: es lo que
 * convierte dos toques del mismo botón en la MISMA venta. Si se generara en el
 * clic, cada toque traería una clave distinta y el servidor cobraría dos veces
 * — que es exactamente el problema que la cabecera vino a resolver.
 */
export async function createSale(input: CreateSaleInput, idempotencyKey: string): Promise<Sale> {
  const { data } = await api.post<Sale>("/pos/sales", input, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// F4-UI-03 — el historial
// ─────────────────────────────────────────────────────────────────────────

/** Una venta del listado: trae su almacén y quién la hizo, ya resuelto. */
export interface SaleRow extends Sale {
  warehouse: { id: string; name: string };
  seller: { id: string; name: string };
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface ListSalesQuery {
  status?: "completed" | "canceled";
  /** Parcial e insensible: nace con el código de barras del ticket. */
  folio?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface SalesPage {
  rows: SaleRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSales(query: ListSalesQuery = {}): Promise<SalesPage> {
  const { data } = await api.get<SalesPage>("/pos/sales", { params: query });
  return data;
}

/**
 * Anular. **No borra: revierte** — el API asienta el movimiento contrario con
 * motivo `sale_return`, así que el kardex muestra la salida y su reverso.
 *
 * El motivo es obligatorio (mínimo 3 caracteres) y no es burocracia: una venta
 * deshecha sin explicación es un descuadre que nadie puede auditar después.
 */
export async function cancelSale(id: string, reason: string): Promise<Sale> {
  const { data } = await api.post<Sale>(`/pos/sales/${id}/cancel`, { reason });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// F4-QUOTE — la cotización
// ─────────────────────────────────────────────────────────────────────────

export type QuoteStatus = "open" | "loaded" | "canceled";

export interface QuoteLine {
  id: string;
  lineNo: number;
  productId: string | null;
  serviceId: string | null;
  presentationId: string | null;
  /** Lo que se cotizó, en texto: sobrevive a que el producto cambie de nombre. */
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface Quote {
  id: string;
  folio: string;
  warehouseId: string;
  status: QuoteStatus;
  total: string;
  note: string | null;
  createdAt: string;
  lines: QuoteLine[];
}

export interface QuoteRow extends Quote {
  warehouse: { id: string; name: string };
  author: { id: string; name: string };
}

export interface CreateQuoteInput {
  warehouseId?: string;
  lines: { productId?: string; serviceId?: string; presentationId?: string; quantity: number }[];
  note?: string;
}

export interface ListQuotesQuery {
  folio?: string;
  status?: QuoteStatus;
  /** Días del calendario del negocio (`YYYY-MM-DD`), no instantes. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface QuotesPage {
  rows: QuoteRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Una línea de la cotización, ya resuelta contra el almacén del TURNO. */
export interface QuoteForSaleLine {
  lineNo: number;
  productId: string | null;
  serviceId: string | null;
  presentationId: string | null;
  description: string;
  quantity: string;
  /** Lo que decía el PAPEL. Se muestra para poder explicar la diferencia. */
  quotedUnitPrice: string;
  /** Lo que cuesta HOY. Es lo que se va a cobrar. `null` si ya no se vende. */
  unitPrice: string | null;
  unavailable: boolean;
  /** Cuánto falta, en unidad base. `null` si alcanza. */
  shortfall: string | null;
  /**
   * Lo que el carrito necesita para armar la línea, en SU propio contrato — el
   * mismo `LookupItem` que devuelve el buscador. `null` cuando el ítem ya no se
   * puede vender desde este almacén.
   */
  item: LookupItem | null;
}

export interface QuoteForSale {
  id: string;
  folio: string;
  status: QuoteStatus;
  warehouseId: string;
  note: string | null;
  quotedTotal: string;
  lines: QuoteForSaleLine[];
}

export async function createQuote(input: CreateQuoteInput): Promise<Quote> {
  const { data } = await api.post<Quote>("/pos/quotes", input);
  return data;
}

export async function listQuotes(query: ListQuotesQuery = {}): Promise<QuotesPage> {
  const { data } = await api.get<QuotesPage>("/pos/quotes", { params: query });
  return data;
}

export async function cancelQuote(id: string, reason?: string): Promise<Quote> {
  const { data } = await api.post<Quote>(
    `/pos/quotes/${id}/cancel`,
    reason === undefined ? {} : { reason },
  );
  return data;
}

/**
 * F4-QUOTE-02 — la cotización lista para cobrar.
 *
 * Exige turno abierto: la disponibilidad se resuelve contra el almacén de ESE
 * turno, que puede no ser el de la cotización — se cotiza en la sucursal y se
 * cobra en la central.
 */
export async function getQuoteForSale(folio: string): Promise<QuoteForSale> {
  const { data } = await api.get<QuoteForSale>(
    `/pos/quotes/folio/${encodeURIComponent(folio)}/for-sale`,
  );
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// F4-TICKET-02 — el papel
// ─────────────────────────────────────────────────────────────────────────

/** Los dos anchos de papel térmico del mercado. */
export type TicketWidth = "58mm" | "80mm";

/**
 * Baja el ticket y lo abre para imprimir.
 *
 * ── Por qué no es un `<a href>` ─────────────────────────────────────────
 *
 * El endpoint exige el Bearer y un link plano iría sin token, devolviendo un
 * 401 sin explicación. Va por axios con `responseType: 'blob'`, igual que el
 * PDF de documentos de F3.
 *
 * ── `window.open` y no `window.print` sobre la página ───────────────────
 *
 * El tablero decía `window.print` + CSS `@page`, que imprime lo que está en
 * pantalla. Pero el ticket ya viene del servidor como PDF con su tamaño de
 * papel correcto: reimprimirlo desde el DOM significaría mantener DOS
 * plantillas —una en pdfmake y otra en CSS— que un día dirían cosas distintas.
 * Se abre el PDF, que es el mismo papel que se archiva.
 *
 * ── Fallar no pierde nada ───────────────────────────────────────────────
 *
 * Si el navegador bloquea la ventana o la descarga falla, la venta YA está
 * cobrada y el ticket se puede volver a sacar del historial. Por eso esto
 * lanza y quien llama solo avisa: no hay nada que deshacer.
 */
export async function printTicket(
  kind: "sale" | "quote",
  id: string,
  folio: string,
  width: TicketWidth = "58mm",
): Promise<void> {
  const { data } = await api.get<Blob>(
    `/pos/${kind === "sale" ? "sales" : "quotes"}/${id}/ticket`,
    {
      responseType: "blob",
      params: { width },
    },
  );

  const url = URL.createObjectURL(data);
  const ventana = window.open(url);
  if (ventana === null) {
    // Bloqueador de popups: se cae a la descarga, que ningún navegador frena.
    // Peor imprimir en dos pasos que no poder imprimir.
    //
    // Usa `dispararDescarga` y NO `descargarBlob` porque esa revocaría la URL,
    // y acá la ventana —cuando sí abre— todavía la está cargando.
    dispararDescarga(url, `${folio}.pdf`);
  }
  // No se revoca de inmediato: la ventana todavía está cargando el blob y
  // revocarlo acá la deja en blanco. El navegador lo libera al cerrarla.
}
