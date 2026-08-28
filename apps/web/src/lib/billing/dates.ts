/**
 * Las fechas del cobro, en la zona del NEGOCIO.
 *
 * ── Los dos errores que estas funciones existen para evitar ─────────────
 *
 * **1. La zona.** `toLocaleDateString()` usa la del navegador. El
 * vencimiento de un negocio de Ciudad de México no cambia porque su dueño
 * abra la app desde Madrid: la fecha de cobro es un hecho del negocio, no
 * del dispositivo. Por eso todas piden `timeZone` — el del tenant, que ya
 * viaja en la sesión.
 *
 * **2. El límite abierto.** Los vencimientos se guardan como el arranque del
 * día SIGUIENTE al último día hábil (misma convención que el server). Así
 * que el día que el cliente reconoce como "su vencimiento" es el del
 * milisegundo anterior. Formatear el instante crudo muestra un día de más —
 * y en una pantalla de cobro, un día de más es una promesa que no vas a
 * cumplir.
 *
 * `formatInstant` es para los hechos puntuales (cuándo se pagó);
 * `formatDeadline` para los límites (vence, fin de trial, fin de gracia,
 * fin de período).
 */

const localeTag = (locale: string): string => (locale === "en" ? "en-US" : "es-MX");

function format(iso: string | null, timeZone: string | undefined, locale: string): string {
  if (!iso) {
    return "—";
  }
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) {
    return "—";
  }
  // `timeZone: undefined` deja la del navegador: el peor caso conocido, no
  // una fecha inventada.
  return instante.toLocaleDateString(localeTag(locale), timeZone ? { timeZone } : undefined);
}

/** Un instante puntual —cuándo pasó algo— en la zona del negocio. */
export function formatInstant(
  iso: string | null,
  timeZone: string | undefined,
  locale: string,
): string {
  return format(iso, timeZone, locale);
}

/**
 * Un límite ABIERTO (vencimiento, fin de trial, fin de período): el día
 * legible es el del milisegundo anterior al instante guardado.
 */
export function formatDeadline(
  iso: string | null,
  timeZone: string | undefined,
  locale: string,
): string {
  if (!iso) {
    return "—";
  }
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) {
    return "—";
  }
  return format(new Date(instante - 1).toISOString(), timeZone, locale);
}
