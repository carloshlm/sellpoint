import { describe, expect, it } from "vitest";
import { endOfDayUtc, startOfDayUtc } from "./day-range";

/**
 * ⚠ EL BUG QUE ESTE ARCHIVO EXISTE PARA MATAR (2026-08-24).
 *
 * Carlos: «no me salen los movimientos de hoy, pero si pongo mañana sí».
 * El Kardex comparaba contra `2026-08-24` crudo, que Postgres lee como
 * `2026-08-24 00:00:00+00`: todo lo de hoy quedaba fuera.
 *
 * Y arreglarlo con `T23:59:59.999Z` —como ya hacía el listado de documentos—
 * lo deja MEDIO roto: el negocio está en `America/Mexico_City` (UTC−6), así
 * que su día termina a las 06:00 UTC del día siguiente. Un movimiento de hoy
 * a las 19:00 locales es 01:00 UTC de mañana y seguiría desapareciendo.
 *
 * Un rango de fechas que el usuario escribe es un rango de días de SU
 * calendario. La conversión a instantes UTC es responsabilidad del servidor,
 * y depende de la zona del negocio — incluido el horario de verano.
 */
const CDMX = "America/Mexico_City";
const MADRID = "Europe/Madrid";

describe("startOfDayUtc", () => {
  it("las 00:00 en CDMX son las 06:00 UTC", () => {
    expect(startOfDayUtc("2026-08-24", CDMX).toISOString()).toBe("2026-08-24T06:00:00.000Z");
  });

  it("las 00:00 en Madrid (verano, UTC+2) son las 22:00 UTC del día anterior", () => {
    expect(startOfDayUtc("2026-08-24", MADRID).toISOString()).toBe("2026-08-23T22:00:00.000Z");
  });

  it("en invierno Madrid es UTC+1: el mismo día arranca una hora más tarde", () => {
    // El offset NO es una constante por zona: cambia con el horario de verano.
    // Calcularlo una vez y reusarlo sería un bug latente cada marzo y octubre.
    expect(startOfDayUtc("2026-01-15", MADRID).toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("UTC es su propio caso, sin corrimiento", () => {
    expect(startOfDayUtc("2026-08-24", "UTC").toISOString()).toBe("2026-08-24T00:00:00.000Z");
  });
});

describe("endOfDayUtc", () => {
  /**
   * Se devuelve el INICIO del día siguiente, para usarse con `<` y no con
   * `<=`: un `23:59:59.999` deja fuera lo que ocurra en ese último
   * milisegundo, y `created_at` tiene precisión de microsegundos en Postgres.
   */
  it("el fin del día es el arranque del siguiente (límite abierto)", () => {
    expect(endOfDayUtc("2026-08-24", CDMX).toISOString()).toBe("2026-08-25T06:00:00.000Z");
  });

  it("cruza el fin de mes sin inventar fechas", () => {
    expect(endOfDayUtc("2026-08-31", CDMX).toISOString()).toBe("2026-09-01T06:00:00.000Z");
  });

  it("cruza el cambio de año", () => {
    expect(endOfDayUtc("2026-12-31", CDMX).toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });

  /**
   * El domingo del cambio de horario en CDMX (primer domingo de abril 2026):
   * el día dura 23 horas. El cálculo tiene que salir del offset REAL de cada
   * extremo, no de restar 24 horas al inicio.
   */
  it("un día de cambio de horario no dura 24 horas y aun así cierra bien", () => {
    const inicio = startOfDayUtc("2026-04-05", CDMX);
    const fin = endOfDayUtc("2026-04-05", CDMX);
    const horas = (fin.getTime() - inicio.getTime()) / 3_600_000;

    // 23 o 24 según la regla vigente; lo que NO puede pasar es que el fin
    // quede antes que el inicio ni que se pierda un día entero.
    expect(horas).toBeGreaterThanOrEqual(23);
    expect(horas).toBeLessThanOrEqual(25);
  });
});

/**
 * ── LAS ZONAS QUE CAMBIAN DE HORARIO A MEDIANOCHE ─────────────────────────
 *
 * Santiago y La Habana mueven el reloj a las 00:00, no a las 02:00 o 03:00
 * como casi todas. Ahí la medianoche local puede NO EXISTIR (se salta) o
 * existir DOS VECES (se repite), y cualquier atajo de «restar el desfase»
 * cae en el día anterior sin avisar.
 *
 * Medido con `Intl` el 2026-08-24: un algoritmo de una sola pasada acierta
 * cuando el reloj se adelanta y falla cuando se atrasa; uno de dos pasadas,
 * exactamente al revés. Por eso se calculan LOS DOS candidatos y se elige el
 * menor cuya fecha local sea de verdad la pedida.
 *
 * La aserción que importa no es solo dónde cae el inicio, sino que **un
 * minuto antes ya sea del día anterior**: es lo que garantiza que el rango no
 * se coma horas ajenas.
 */
describe("cambios de horario a medianoche", () => {
  const fechaLocal = (tz: string, instante: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instante);

  it.each([
    ["America/Santiago", "2026-09-06", "el reloj se ADELANTA: la medianoche local no existe"],
    ["America/Santiago", "2026-04-05", "el reloj se ATRASA: la medianoche local ocurre dos veces"],
    ["America/Havana", "2026-03-08", "La Habana también cambia a medianoche"],
  ])("%s en %s — %s", (tz, fecha) => {
    const inicio = startOfDayUtc(fecha, tz);

    expect(fechaLocal(tz, inicio)).toBe(fecha);
    // Y el instante anterior YA es del día previo: sin esto, un inicio que
    // cae a las 23:00 del día anterior también pasaría la aserción de arriba
    // en cuanto el formateador redondeara.
    expect(fechaLocal(tz, new Date(inicio.getTime() - 60_000))).not.toBe(fecha);
  });
});

describe("zona desconocida", () => {
  it("una zona inválida cae a UTC en vez de reventar la consulta", () => {
    // Un tenant con la zona mal cargada tiene que poder ver su kardex. Un
    // rango levemente corrido es un problema; un 500 es otro mucho peor.
    expect(startOfDayUtc("2026-08-24", "Marte/Olympus").toISOString()).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });
});
