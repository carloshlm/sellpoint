/**
 * F10-MANFIX-03 — el ancho del papel térmico, por COMPUTADORA.
 *
 * ── Por qué vive en el navegador y no en la cuenta ──────────────────────
 *
 * La impresora está conectada a ESTA computadora, no a la cuenta: dos cajas
 * con impresoras distintas funcionan cada una con la suya. Mismo criterio que
 * `sellpoint.locale` (idioma del navegador) y `sellpoint.quickCatalog` (el
 * borrador de carga rápida).
 *
 * ── Por qué el valor de ENTRADA es 58 mm y no 80 mm ─────────────────────
 *
 * Los dos errores no cuestan lo mismo: un ticket de 58 mm en una impresora de
 * 80 sale angosto pero se lee completo; uno de 80 en una de 58 se corta o se
 * encoge hasta no leerse. Además 58 mm es lo que se imprime hoy, así que
 * nadie ve un cambio al salir esta versión — quien tiene impresora de 80 la
 * elige una vez, en esa computadora, desde Mi perfil › Preferencias.
 *
 * ── Si el navegador no deja guardar ─────────────────────────────────────
 *
 * En ventana privada o con el almacenamiento bloqueado, leer o escribir
 * revienta. Se degrada al valor de entrada: perder la preferencia en esta
 * sesión es aceptable, romper la impresión no.
 */

export type TicketWidth = "58mm" | "80mm";

const STORAGE_KEY = "sellpoint.ticketWidth";
const DEFAULT_WIDTH: TicketWidth = "58mm";

function esAnchoValido(valor: string | null): valor is TicketWidth {
  return valor === "58mm" || valor === "80mm";
}

/** El ancho elegido en ESTA computadora, o el valor de entrada (58 mm). */
export function getTicketWidthPreference(): TicketWidth {
  try {
    const guardado = localStorage.getItem(STORAGE_KEY);
    return esAnchoValido(guardado) ? guardado : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** Guarda el ancho elegido en ESTA computadora. No lanza si no se pudo. */
export function setTicketWidthPreference(width: TicketWidth): void {
  try {
    localStorage.setItem(STORAGE_KEY, width);
  } catch {
    // Modo privado o cuota llena: la elección no sobrevive a esta sesión,
    // pero no rompe nada — la próxima impresión cae al valor de entrada.
  }
}
