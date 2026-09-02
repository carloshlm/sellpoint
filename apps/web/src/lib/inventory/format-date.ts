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

/**
 * Un INSTANTE del documento (`createdAt`, `confirmedAt`, `canceledAt`) como
 * día —o día y hora— del calendario del NEGOCIO.
 *
 * Por qué la zona del negocio y no la del navegador (Carlos, 2026-09-02): es
 * la misma con la que el API corta el rango Desde/Hasta. Si la celda dijera
 * «19/08» en el navegador de alguien en Madrid y el filtro «Hasta 18/08»
 * incluyera esa fila, la pantalla se contradiría a sí misma. `timeZone`
 * ausente (sesión vieja) cae a la del navegador; una zona inválida también,
 * porque `Intl` lanza y un listado que revienta es peor que uno corrido.
 */
export function formatBusinessDate(
  iso: string,
  locale: string,
  timeZone: string | undefined,
  withTime = false,
): string {
  const opciones: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" } : {}),
  };
  const instante = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, { ...opciones, ...(timeZone ? { timeZone } : {}) })
      .format(instante)
      .replace(",", "");
  } catch {
    return new Intl.DateTimeFormat(locale, opciones).format(instante).replace(",", "");
  }
}
