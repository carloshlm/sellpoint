/**
 * Convierte un día del calendario del NEGOCIO en instantes UTC.
 *
 * ── Por qué existe (2026-08-24) ───────────────────────────────────────────
 *
 * Carlos: «no me salen los movimientos de hoy, pero si pongo mañana sí». El
 * Kardex mandaba `2026-08-24` crudo a Postgres, que lo lee como
 * `2026-08-24 00:00:00+00`: todo lo del día quedaba fuera del rango.
 *
 * Y el atajo de poner `T23:59:59.999Z` —que ya usaba el listado de
 * documentos— deja el arreglo A MEDIAS: un negocio en `America/Mexico_City`
 * (UTC−6) termina su día a las 06:00 UTC del siguiente, así que un movimiento
 * de las 19:00 locales cae en el día UTC de mañana y sigue desapareciendo.
 *
 * La regla: **un rango de fechas que el usuario escribe es un rango de días de
 * SU calendario**. Traducirlo a instantes es del servidor, y depende de la
 * zona del negocio, horario de verano incluido.
 */

/**
 * El desfase de la zona respecto a UTC, en minutos, EN ESE INSTANTE.
 *
 * Se calcula por instante y no por zona porque el horario de verano lo mueve:
 * Madrid es UTC+1 en enero y UTC+2 en agosto. Guardar «el offset de la zona»
 * sería un bug latente cada marzo y cada octubre.
 */
function desfaseEnMinutos(timeZone: string, instante: Date): number {
  const formato = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const partes: Record<string, number> = {};
  for (const parte of formato.formatToParts(instante)) {
    if (parte.type !== "literal") {
      partes[parte.type] = Number(parte.value);
    }
  }

  // `formatToParts` devuelve 24 para la medianoche en algunas plataformas.
  const hora = partes.hour === 24 ? 0 : (partes.hour ?? 0);
  const comoSiFueraUtc = Date.UTC(
    partes.year ?? 1970,
    (partes.month ?? 1) - 1,
    partes.day ?? 1,
    hora,
    partes.minute ?? 0,
    partes.second ?? 0,
  );

  return (comoSiFueraUtc - instante.getTime()) / 60_000;
}

/** La fecha del calendario (`YYYY-MM-DD`) que ese instante tiene en esa zona. */
function fechaLocalDe(timeZone: string, instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/**
 * El instante UTC en que arranca ese día del calendario, en esa zona.
 *
 * ── Por qué DOS candidatos y no una resta (medido el 2026-08-24) ─────────
 *
 * Casi todas las zonas cambian de horario a las 02:00 o 03:00, y ahí basta
 * con restar el desfase. Pero Santiago y La Habana lo cambian **a
 * medianoche**: ese día la medianoche local o NO EXISTE (el reloj salta de
 * 00:00 a 01:00) o existe DOS VECES (vuelve de 00:00 a 23:00).
 *
 * Se midió con `Intl` y el resultado fue contraintuitivo: un algoritmo de una
 * sola pasada acierta cuando el reloj se ADELANTA y falla cuando se ATRASA;
 * uno de dos pasadas, exactamente al revés — y el fallo no revienta, aterriza
 * en las 23:00 del día ANTERIOR y mete horas ajenas en el rango.
 *
 * Por eso se calculan los dos y se elige por evidencia: el MENOR cuya fecha
 * local sea de verdad la pedida. Si ninguno lo es —zona con una regla más
 * rara todavía— se usa el primero, que es la aproximación conocida.
 */
export function startOfDayUtc(isoDate: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const medianocheUtc = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);

  try {
    const primero = new Date(
      medianocheUtc - desfaseEnMinutos(timeZone, new Date(medianocheUtc)) * 60_000,
    );
    const segundo = new Date(medianocheUtc - desfaseEnMinutos(timeZone, primero) * 60_000);

    const validos = [primero, segundo]
      .filter((candidato) => fechaLocalDe(timeZone, candidato) === isoDate)
      .sort((a, b) => a.getTime() - b.getTime());

    return validos[0] ?? primero;
  } catch {
    // Un tenant con la zona mal cargada tiene que poder ver su kardex: un
    // rango levemente corrido es un problema, un 500 es otro mucho peor.
    return new Date(medianocheUtc);
  }
}

/**
 * El instante UTC en que TERMINA ese día: el arranque del siguiente.
 *
 * Límite ABIERTO a propósito — se usa con `<`, no con `<=`. Un
 * `23:59:59.999` deja fuera lo que ocurra en ese último milisegundo, y
 * `created_at` guarda microsegundos en Postgres.
 */
export function endOfDayUtc(isoDate: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const siguiente = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));

  return startOfDayUtc(siguiente.toISOString().slice(0, 10), timeZone);
}
