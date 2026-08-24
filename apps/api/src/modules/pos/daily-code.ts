import { localCalendarDate } from "@sellpoint/shared";

/**
 * El código de barras diario del ticket: `YYYYMMDD` + consecutivo de 4
 * (`202608240045` = ticket 45 del 24/08/2026 del negocio).
 *
 * Función PURA extraída de `crearVenta` para poder fijar lo que el e2e no
 * puede: que el día es el del NEGOCIO. Un e2e que compara «hoy CDMX» contra
 * «hoy UTC» pasa en verde 18 horas al día porque las fechas coinciden — la
 * contraprueba de la zona solo discrimina con un instante elegido a mano
 * (23:30 de CDMX = 05:30 UTC del día siguiente), y eso es un unit test.
 *
 * `padStart(4)` promete 9999 ventas por día; la 10,000 crece a 5 dígitos en
 * vez de romper el cobro — el mismo principio del folio.
 */
export function dailyTicketCode(timeZone: string, instant: Date, consecutive: bigint): string {
  const compactDate = localCalendarDate(timeZone, instant).replaceAll("-", "");

  return `${compactDate}${String(consecutive).padStart(4, "0")}`;
}
