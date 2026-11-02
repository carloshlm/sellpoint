import type { InventoryDocumentType, MovementReason } from "./inventory";

/**
 * La caducidad de un lote: qué fecha se puede capturar y qué es «hoy».
 *
 * ── Por qué existe (Carlos, 2026-11-02) ───────────────────────────────────
 *
 * En producción, un lote de «Materna c/30 tabletas» se guardó con caducidad
 * 0027-10-01 en vez de 2027-10-01: en el campo de fecha del navegador basta
 * con teclear «27» en el año para que quede el año 27. El API solo revisaba
 * que fuera una fecha con forma `AAAA-MM-DD`, y lo era.
 *
 * Dos reglas, en UN lugar para el API y el web:
 *
 *  1. **El año va de 2000 a 2099** en todo lugar donde se captura una
 *     caducidad. Fuera de ese rango es un error de captura, no un producto.
 *  2. **Una entrada de mercancía no trae algo ya caducado** («que no se pueda
 *     dar entrada si la caducidad es fecha pasada»). Caducar HOY se permite:
 *     el día que caduca, el lote todavía sirve.
 *
 * «Hoy» es la medianoche UTC, el MISMO corte que ya usaban la etiqueta
 * «Vencido» de existencias, FEFO y «próximos a vencer»: `expires_at` es una
 * columna DATE y compararla contra un instante con hora correría el corte
 * según el huso del servidor.
 */
export const LOT_EXPIRY_MIN_YEAR = 2000;
export const LOT_EXPIRY_MAX_YEAR = 2099;
/** Los extremos como `AAAA-MM-DD`, para el `min`/`max` de un `<input type="date">`. */
export const LOT_EXPIRY_MIN_DATE = `${LOT_EXPIRY_MIN_YEAR}-01-01`;
export const LOT_EXPIRY_MAX_DATE = `${LOT_EXPIRY_MAX_YEAR}-12-31`;

export type LotExpiryProblem = "year_out_of_range" | "in_past";

/**
 * Las entradas que rechazan una caducidad pasada: las que meten mercancía
 * NUEVA al negocio y se eligen en un formulario (compra, ajuste, devolución
 * de un cliente).
 *
 * Lo que NO está importa tanto como lo que está: el traspaso (`transfer`), la
 * devolución del POS (`sale_return`) y el conteo físico (`physical_count`)
 * mueven lotes que YA eran del negocio. Concentrar lo vencido en el CEDIS es
 * un flujo legítimo, y bloquear su recepción dejaría el traspaso en tránsito
 * para siempre; un conteo que no pudiera contar lo vencido no cuadraría nunca.
 */
export const REASONS_REJECTING_PAST_EXPIRY = ["invoice", "adjustment", "customer_return"] as const;

/** ¿Esta entrada tiene prohibido traer una caducidad pasada? */
export function rejectsPastExpiry(reason: MovementReason | null | undefined): boolean {
  return (
    reason !== null &&
    reason !== undefined &&
    (REASONS_REJECTING_PAST_EXPIRY as readonly string[]).includes(reason)
  );
}

/**
 * ¿Las líneas de este documento de inventario son mercancía que ENTRA? Solo
 * las entradas cuyo motivo lo rechaza (`rejectsPastExpiry`); el conteo, las
 * salidas y la recepción de un traspaso, no.
 *
 * Una entrada SIN motivo todavía es un borrador a medias: los tres motivos que
 * se le pueden elegir rechazan lo caducado, así que se trata como si ya lo
 * tuviera. La recepción de un traspaso nace con `transfer` desde el servidor.
 */
export function documentRejectsPastExpiry(document: {
  type: InventoryDocumentType;
  reasonCode: MovementReason | null;
}): boolean {
  return (
    document.type === "entry" &&
    (document.reasonCode === null || rejectsPastExpiry(document.reasonCode))
  );
}

/** Hoy, como lo cuenta una caducidad: la medianoche UTC de ese instante. */
export function lotExpiryToday(now: Date = new Date()): Date {
  const hoy = new Date(now.getTime());
  hoy.setUTCHours(0, 0, 0, 0);
  return hoy;
}

/** Hoy como `AAAA-MM-DD` (el `min` de una caducidad en una entrada). */
export function lotExpiryTodayIso(now: Date = new Date()): string {
  return lotExpiryToday(now).toISOString().slice(0, 10);
}

/**
 * Una caducidad tecleada (`AAAA-MM-DD`) o guardada (la DATE que devuelve
 * Prisma, a medianoche UTC) como `Date`. El texto ISO se lee tal cual: a
 * diferencia de `Date.UTC(27, …)`, `new Date("0027-10-01")` NO suma 1900.
 */
function comoFecha(value: string | Date): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** `AAAA-MM-DD`, que es como la nombran los mensajes de lote. */
export function lotExpiryIsoDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** ¿El año está entre 2000 y 2099? Lo que no es una fecha, no. */
export function isLotExpiryYearInRange(value: string | Date): boolean {
  const fecha = comoFecha(value);
  if (Number.isNaN(fecha.getTime())) {
    return false;
  }
  const anio = fecha.getUTCFullYear();
  return anio >= LOT_EXPIRY_MIN_YEAR && anio <= LOT_EXPIRY_MAX_YEAR;
}

/** ¿Ya caducó? Estrictamente ANTES de hoy: caducar hoy no es haber caducado. */
export function isLotExpiryPast(value: string | Date, now: Date = new Date()): boolean {
  return comoFecha(value).getTime() < lotExpiryToday(now).getTime();
}

/**
 * El problema de una caducidad, o `null` si sirve. El año va primero: un
 * 0027 es un error de captura antes que una fecha pasada, y decirle «ya
 * pasó» a quien quiso escribir 2027 lo mandaría a buscar el error equivocado.
 */
export function lotExpiryProblem(
  value: string | Date,
  options: { rejectPast: boolean; now?: Date },
): LotExpiryProblem | null {
  if (!isLotExpiryYearInRange(value)) {
    return "year_out_of_range";
  }
  if (options.rejectPast && isLotExpiryPast(value, options.now)) {
    return "in_past";
  }
  return null;
}
