import { z } from "zod";

/**
 * F9-PO-01 — los contratos de Órdenes de compra.
 *
 * Una orden nace BORRADOR, se EMITE (`open`: es el compromiso con el
 * proveedor y de ahí sale el PDF que se le manda), se va RECIBIENDO por
 * partes (`partially_received` → `received`), y una persona la CIERRA
 * (`closed`: lo que faltaba ya no llegará) o la ANULA. No se borra nunca:
 * las recepciones y las compras la apuntan.
 */
export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "open",
  "partially_received",
  "received",
  "closed",
  "canceled",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export const purchaseOrderStatusSchema = z.enum(PURCHASE_ORDER_STATUSES);

/**
 * La recepción es el papel del ANDÉN: qué llegó, con qué remisión y con qué
 * lote. No mueve existencias —eso lo hace la entrada que nace de la compra—,
 * así que confirmarla solo suma a lo recibido de la orden.
 */
export const PURCHASE_RECEIPT_STATUSES = ["draft", "confirmed", "canceled"] as const;
export type PurchaseReceiptStatus = (typeof PURCHASE_RECEIPT_STATUSES)[number];
export const purchaseReceiptStatusSchema = z.enum(PURCHASE_RECEIPT_STATUSES);

/** Los estados que se DERIVAN de las líneas; `closed` y `canceled` los pone una persona. */
export type DerivedPurchaseOrderStatus = Extract<
  PurchaseOrderStatus,
  "open" | "partially_received" | "received"
>;

/** Una cantidad decimal en texto → entero escalado. Solo dígitos y un punto. */
function escalar(valor: string, escala: number): bigint {
  const limpio = valor.trim();
  if (!/^\d+(\.\d+)?$/.test(limpio)) {
    throw new Error(`cantidad inválida: ${JSON.stringify(valor)}`);
  }
  const [entero = "0", decimales = ""] = limpio.split(".");
  return BigInt(`${entero}${decimales.padEnd(escala, "0").slice(0, escala)}`);
}

function decimalesDe(valor: string): number {
  return valor.trim().split(".")[1]?.length ?? 0;
}

/** Entero escalado → texto decimal sin ceros de sobra (`40.2500` → `40.25`, `40.0` → `40`). */
function aTexto(valor: bigint, escala: number): string {
  if (escala === 0) {
    return valor.toString();
  }
  const digitos = valor.toString().padStart(escala + 1, "0");
  const entero = digitos.slice(0, digitos.length - escala);
  const decimales = digitos.slice(digitos.length - escala).replace(/0+$/, "");
  return decimales === "" ? entero : `${entero}.${decimales}`;
}

/**
 * Lo que falta por recibir de una línea: `pedido − recibido`, en decimal y
 * sin `Number` (las cantidades son `NUMERIC(14,4)`; `0.3 − 0.1` en flotante
 * no es `0.2`). Nunca negativo: recibir de más lo rebota el API antes.
 */
export function pendingQuantity(ordered: string, received: string): string {
  const escala = Math.max(decimalesDe(ordered), decimalesDe(received));
  const resto = escalar(ordered, escala) - escalar(received, escala);
  return aTexto(resto < 0n ? 0n : resto, escala);
}

export interface PurchaseOrderLineProgress {
  ordered: string;
  received: string;
  /** El proveedor ya no surtirá el resto: la línea se da por terminada. */
  closedShort: boolean;
}

/**
 * El estado de una orden emitida, DERIVADO de sus líneas. Es la única fuente
 * de verdad después de cada recepción (confirmar o anular una), y por eso es
 * pura: la misma entrada da siempre la misma salida, y se prueba sin base.
 *
 *  - todas las líneas terminadas (completas o cerradas cortas) → `received`;
 *  - alguna línea con algo recibido o cerrada corta → `partially_received`;
 *  - nada tocado → `open`.
 */
export function purchaseOrderStatusFrom(
  lines: readonly PurchaseOrderLineProgress[],
): DerivedPurchaseOrderStatus {
  if (lines.length === 0) {
    return "open";
  }
  let terminadas = 0;
  let tocadas = 0;
  for (const linea of lines) {
    const escala = Math.max(decimalesDe(linea.ordered), decimalesDe(linea.received));
    const recibido = escalar(linea.received, escala);
    const completa = recibido >= escalar(linea.ordered, escala);
    if (completa || linea.closedShort) {
      terminadas += 1;
    }
    if (recibido > 0n || linea.closedShort) {
      tocadas += 1;
    }
  }
  if (terminadas === lines.length) {
    return "received";
  }
  return tocadas > 0 ? "partially_received" : "open";
}

/**
 * Lo que el listado y el detalle DICEN de una orden (Carlos, 2026-09-12: «un
 * estatus para saber si ya fue asignada a una compra»). `invoiced` se DERIVA:
 * la orden terminó de recibirse (`received` o cerrada con faltante) y TODAS
 * sus recepciones confirmadas ya tienen su compra (viva). El estado
 * persistido no cambia — sigue siendo lo que dicen las recepciones — y una
 * compra anulada devuelve la orden a «recibida», porque vuelve a tener papel
 * sin factura.
 */
export const PURCHASE_ORDER_VIEW_STATUSES = [
  "draft",
  "open",
  "partially_received",
  "received",
  "closed",
  "invoiced",
  "canceled",
] as const;
export type PurchaseOrderViewStatus = (typeof PURCHASE_ORDER_VIEW_STATUSES)[number];
export const purchaseOrderViewStatusSchema = z.enum(PURCHASE_ORDER_VIEW_STATUSES);

export interface PurchaseOrderReceiptProgress {
  status: string;
  /** El estado de la compra que la factura; `null` si todavía no tiene. */
  purchaseStatus: string | null;
}

export function purchaseOrderViewStatus(
  status: PurchaseOrderStatus,
  receipts: readonly PurchaseOrderReceiptProgress[],
): PurchaseOrderViewStatus {
  if (status !== "received" && status !== "closed") {
    return status;
  }
  const confirmadas = receipts.filter((r) => r.status === "confirmed");
  if (confirmadas.length === 0) {
    return status;
  }
  const todasFacturadas = confirmadas.every(
    (r) => r.purchaseStatus !== null && r.purchaseStatus !== "canceled",
  );
  return todasFacturadas ? "invoiced" : status;
}

/**
 * Cuánto de lo pedido ya llegó, en por ciento entero (0–100), sumando TODAS
 * las líneas en su propia unidad — es una lectura de avance, no dinero. Sin
 * líneas, 0; recibir de más no pasa de 100.
 */
export function receivedPercent(lines: readonly PurchaseOrderLineProgress[]): number {
  let pedido = 0n;
  let recibido = 0n;
  const escala = Math.max(
    0,
    ...lines.map((l) => Math.max(decimalesDe(l.ordered), decimalesDe(l.received))),
  );
  for (const linea of lines) {
    pedido += escalar(linea.ordered, escala);
    recibido += escalar(linea.received, escala);
  }
  if (pedido <= 0n) {
    return 0;
  }
  const pct = Number((recibido * 100n) / pedido);
  return Math.max(0, Math.min(100, pct));
}
