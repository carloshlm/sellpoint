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
 *
 * F10-MANFIX-19 — con `withTime`, la HORA sale por `formatBusinessTime` y no
 * por `timeStyle` en la misma llamada: varias pantallas le pasaban a este
 * `locale` un BCP-47 con región («es-MX»/«en-US», calculado a mano) y la
 * hora se imprimía «8:45 a.m.», el formato de 12 horas que la 16 ya había
 * sacado de la barra del turno y el panel del vendedor. La FECHA sigue
 * exactamente igual —con el `locale` que llega, con o sin región— porque ahí
 * sí importa conservar el cero a la izquierda del mes.
 */
export function formatBusinessDate(
  iso: string,
  locale: string,
  timeZone: string | undefined,
  withTime = false,
): string {
  const opciones: Intl.DateTimeFormatOptions = { dateStyle: "short" };
  const instante = new Date(iso);
  let fecha: string;
  try {
    fecha = new Intl.DateTimeFormat(locale, { ...opciones, ...(timeZone ? { timeZone } : {}) })
      .format(instante)
      .replace(",", "");
  } catch {
    fecha = new Intl.DateTimeFormat(locale, opciones).format(instante).replace(",", "");
  }
  if (!withTime) {
    return fecha;
  }
  // El idioma PLANO («es»/«en»): la región es lo único que decidía el
  // «a.m.», y `formatBusinessTime` ya resuelve zona ausente o inválida.
  const idioma = locale.split("-")[0] ?? locale;
  return `${fecha} ${formatBusinessTime(iso, idioma, timeZone)}`;
}

/**
 * La HORA de un instante en el reloj del NEGOCIO, con el formato de hora de
 * toda la app: `timeStyle: "short"` en el idioma de la interfaz, «8:45» en
 * español y «8:45 AM» en inglés.
 *
 * F10-MANFIX-16: la barra del punto de venta decía «08:45» y el panel del
 * vendedor «08:45 a.m.» para la MISMA apertura de turno —dos formateadores con
 * opciones y locales distintos—, y el reporte de cierres la muestra con
 * `timeStyle` en la zona del negocio. La zona se trata como en
 * `formatBusinessDate`: ausente o inválida, cae a la del navegador.
 */
export function formatBusinessTime(
  iso: string,
  locale: string,
  timeZone: string | undefined,
): string {
  const instante = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, {
      timeStyle: "short",
      ...(timeZone ? { timeZone } : {}),
    }).format(instante);
  } catch {
    return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(instante);
  }
}

/**
 * El «hoy» del calendario del NEGOCIO como `YYYY-MM-DD`, para el `max` de una
 * fecha que no puede ser de mañana. Con la zona del navegador, a las 11 de la
 * noche en Ciudad de México un servidor —o un usuario— en UTC ya está en
 * mañana y la factura del día no cabría. `en-CA` da el ISO directo.
 */
export function businessToday(timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      ...(timeZone ? { timeZone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
