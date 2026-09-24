import { z } from "zod";

/**
 * Los campos de las consultas del inventario que DESCARTAN la basura en vez
 * de reventar: el kárdex, los traspasos y los lotes. Un enlace viejo con
 * `?page=abc` abre la pantalla sin ese filtro, no un 400 que sería una pared
 * en la puerta.
 *
 * Cada uno hace lo mismo que el controlador hacía a mano cuando leía la
 * consulta suelta (F10-MANFIX-20 los pasó a DTO). Los ids NO son de estos: un
 * id mal formado es 400 `common.invalid_id` en todo el API
 * (`optionalIdFilter`), porque descartarlo mostraría datos de TODOS los
 * almacenes a quien pidió uno solo.
 */

/**
 * Un día del calendario (`YYYY-MM-DD`), tal como lo escribió el usuario.
 *
 * NO se convierte a `Date`: traducir un día a instantes depende de la zona del
 * NEGOCIO, y eso lo sabe el servicio, no la consulta. `new Date(raw)` lo leía
 * como medianoche UTC y dejaba fuera lo del día en cualquier zona al oeste de
 * Greenwich (el bug que Carlos reportó el 2026-08-24).
 */
export function lenientDay() {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined);
}

/** Un número mayor que cero, truncado (`2.9` → 2). Lo demás se ignora. */
export function lenientPositiveInt() {
  return z.coerce.number().positive().transform(Math.floor).optional().catch(undefined);
}

/** Un número desde cero, truncado: aquí `0` sí es un valor (`olderThanDays=0`). */
export function lenientNonNegativeInt() {
  return z.coerce.number().nonnegative().transform(Math.floor).optional().catch(undefined);
}

/** Un valor de la lista, o nada si vino otra cosa. */
export function lenientEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values).optional().catch(undefined);
}

/** Un interruptor que viaja por la URL: encendido solo con alguno de `on`. */
export function lenientSwitch(...on: string[]) {
  // El `.optional()` no sobra: en Zod 4 una clave con `z.unknown()` pelado es
  // OBLIGATORIA en el objeto, y la consulta sin el interruptor sería un 400.
  return z
    .unknown()
    .optional()
    .transform((value) => typeof value === "string" && on.includes(value));
}

/** El formato de un export: CSV solo si se pide; cualquier otra cosa, Excel. */
export function lenientFormat() {
  return z.enum(["csv", "xlsx"]).catch("xlsx");
}
