/**
 * Las fechas de CALENDARIO que viajan en los `args` de un mensaje, escritas
 * como las lee quien recibe la respuesta: «01/10/2027» en español y
 * «10/01/2027» en inglés, igual que `formatCalendarDate` del web pinta la
 * caducidad en pantalla (Carlos, 2026-11-02: los mensajes decían
 * «2027-10-01»).
 *
 * Solo la caducidad (`expiresAt`), que es lo que se pidió: las fechas de
 * pedido y de recepción de compras siguen en ISO hasta que alguien lo pida.
 * Agregar un nombre a la lista lo cambia en todos los mensajes que lo usan.
 */
const CALENDAR_DATE_ARGS = ["expiresAt"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function formatCalendarDateArgs(
  args: Record<string, unknown> | undefined,
  locale: string,
): Record<string, unknown> | undefined {
  if (args === undefined) {
    return args;
  }
  const formateados = { ...args };
  for (const nombre of CALENDAR_DATE_ARGS) {
    const valor = args[nombre];
    if (typeof valor === "string" && ISO_DATE.test(valor)) {
      formateados[nombre] = formatCalendarDate(valor, locale);
    }
  }
  return formateados;
}

/**
 * `timeZone: "UTC"` porque la fecha es un día y no un instante: con la zona
 * del servidor se correría un día. El año va SIEMPRE a cuatro cifras: «0027»
 * con `Intl` sale «27», que se lee 2027, justo el error que el mensaje del año
 * fuera de rango tiene que señalar. Una fecha imposible pasa tal cual.
 */
export function formatCalendarDate(iso: string, locale: string): string {
  const fecha = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== iso) {
    return iso;
  }
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  })
    .formatToParts(fecha)
    .map((parte) => (parte.type === "year" ? parte.value.padStart(4, "0") : parte.value))
    .join("");
}
