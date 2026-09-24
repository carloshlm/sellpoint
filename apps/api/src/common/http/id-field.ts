import { z } from "zod";

/**
 * La clave del 400 de un id mal formado: la misma en la ruta (`@UuidParam`),
 * en la consulta y en el cuerpo. «Ese identificador no es válido.»
 */
export const INVALID_ID = "common.invalid_id";

/**
 * F10-MANFIX-20 — un id dentro de un DTO de Zod, con la regla y la clave de
 * `@UuidParam`.
 *
 *   warehouseId: idField().optional(),
 *
 * Existe por los ids de la CONSULTA (`?warehouseId=`, `?lotId=`…). La 17
 * cerró los de la ruta; los de la consulta los revisaba cada DTO con un
 * `z.uuid()` pelado, que contestaba con el `invalid_query` de su módulo, y
 * los handlers sin DTO los dejaban llegar crudos a Prisma: los salvaba el
 * respaldo del filtro de excepciones (`isInvalidUuidInput`), que es una red,
 * no la validación. Con la clave en el campo, el pipe de Zod contesta
 * `common.invalid_id` como mensaje general —y además nombra el campo—, antes
 * de tocar la base.
 *
 * Un solo esquema para los dos: si la regla del uuid cambia, cambia en la
 * ruta y en la consulta a la vez.
 */
export function idField() {
  return z.uuid(INVALID_ID);
}

/**
 * El id OPCIONAL de un filtro que descarta la basura en vez de reventar (el
 * kárdex, los traspasos, los lotes): `?warehouseId=` vacío es «sin filtro»,
 * como lo era cuando esos handlers leían la consulta a mano. Vacío no es un id
 * mal formado; es que no hay id. Cualquier otro texto que no sea uuid sí es
 * 400 `common.invalid_id`.
 */
export function optionalIdFilter() {
  return z.preprocess((value) => (value === "" ? undefined : value), idField().optional());
}
