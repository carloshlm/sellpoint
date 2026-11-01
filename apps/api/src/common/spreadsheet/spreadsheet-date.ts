/**
 * La fecha de una celda de planilla, como texto `AAAA-MM-DD` (Carlos,
 * 2026-11-01).
 *
 * Las columnas de fecha de los Excel van con formato Texto: así una fecha
 * pegada no cambia de formato. El costo es que lo tecleado llega como TEXTO y
 * la importación tiene que entenderlo. Entiende:
 *
 * - `AAAA-MM-DD`, siempre, también con la hora que traen las celdas de fecha
 *   de un archivo viejo (`2026-07-01T00:00:00.000Z`).
 * - `DD/MM/AAAA` como se escribe en México, o `MM/DD/AAAA` en un negocio de
 *   Estados Unidos (`dayFirst = false`); con `/` o `-`.
 * - Año de dos cifras como 20AA: una caducidad no está en el siglo pasado.
 *
 * Lo que no es una fecha clara (31/02, «mañana», un número suelto) vuelve como
 * `invalid`: un día mal leído es peor que un error en la fila.
 */
export function parseSpreadsheetDate(
  raw: string,
  dayFirst: boolean,
): { date: string | null; invalid: boolean } {
  const texto = raw.trim();
  if (texto === "") {
    return { date: null, invalid: false };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(texto);
  if (iso) {
    return fecha(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const conBarras = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(texto);
  if (conBarras) {
    const primero = Number(conBarras[1]);
    const segundo = Number(conBarras[2]);
    const anio = conBarras[3]?.length === 2 ? 2000 + Number(conBarras[3]) : Number(conBarras[3]);
    return dayFirst ? fecha(anio, segundo, primero) : fecha(anio, primero, segundo);
  }

  return { date: null, invalid: true };
}

/** Solo si el día existe en el calendario: el 31 de febrero no se «corrige» a marzo. */
function fecha(anio: number, mes: number, dia: number): { date: string | null; invalid: boolean } {
  const utc = new Date(Date.UTC(anio, mes - 1, dia));
  if (utc.getUTCFullYear() !== anio || utc.getUTCMonth() !== mes - 1 || utc.getUTCDate() !== dia) {
    return { date: null, invalid: true };
  }
  return { date: utc.toISOString().slice(0, 10), invalid: false };
}
