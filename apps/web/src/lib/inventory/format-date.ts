/**
 * Una fecha de CALENDARIO, sin zona horaria.
 *
 * `expires_at` es una columna `DATE`: "1 de julio" y punto, sin hora ni huso.
 * El API la serializa como `2026-07-01T00:00:00.000Z`, y formatearla con el
 * huso local la corre un día hacia atrás en toda América — en CDMX (UTC-6) un
 * lote que vence el **1 de julio** se mostraba como **30/6**.
 *
 * Eso no es un detalle cosmético: es el número por el que alguien decide tirar
 * mercancía buena o vender una vencida. Por eso se fuerza `timeZone: "UTC"`,
 * que devuelve el día tal como se guardó.
 *
 * NO usar esto para `createdAt` ni `confirmedAt`: esos SÍ son instantes, y
 * mostrarlos en la hora local del usuario es lo correcto.
 */
export function formatCalendarDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}
