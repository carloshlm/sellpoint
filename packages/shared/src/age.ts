/**
 * F9-RECEP-01 — años cumplidos entre dos fechas `YYYY-MM-DD`.
 *
 * Las dos fechas ya están en el calendario del NEGOCIO: el llamador las
 * resolvió con `localCalendarDate(tenant.timezone, instante)`. Acá no entra
 * un `Date` ni una zona a propósito — meterlos volvería a un test que falla
 * cada 1 de marzo y a una edad distinta según el reloj del navegador.
 *
 * La edad se calcula y no se guarda: un entero es correcto el día que se
 * teclea y miente en silencio el resto del año (Carlos, 2026-09-02).
 */
export function ageFromBirthDate(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (
    by === undefined ||
    bm === undefined ||
    bd === undefined ||
    ty === undefined ||
    tm === undefined ||
    td === undefined
  ) {
    return 0;
  }
  let edad = ty - by;
  // Todavía no llega el cumpleaños de este año: un año menos. El 29 de
  // febrero cumple el 1 de marzo en años no bisiestos (28 < 29).
  if (tm < bm || (tm === bm && td < bd)) {
    edad -= 1;
  }
  return Math.max(0, edad);
}
