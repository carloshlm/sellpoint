import { z } from "zod";

/**
 * F4-CART-01 — lo que el mostrador teclea o escanea.
 *
 * `q` no se valida por FORMA: el input es uno solo y admite código de barras,
 * SKU, media palabra o folio. Quién reconoce cada cosa son las strategies
 * (`lookup.strategies.ts`), no este esquema — meter acá un patrón obligaría a
 * tocarlo cada vez que se agregue una forma de buscar, que es exactamente lo
 * que el patrón vino a evitar.
 */
export const lookupQuerySchema = z.object({
  q: z.string().trim().min(1, "pos.lookup_query_required").max(64),
  /**
   * El tope de la lista. Chico a propósito: en una pantalla táctil de
   * mostrador, veinte renglones ya son más de los que alguien recorre — pedir
   * doscientos sería trabajo de base que nadie mira.
   */
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /**
   * Contra qué almacén resolver, cuando NO hay turno (F4-QUOTE-03).
   *
   * La venta no lo manda nunca: hereda el del turno, y sin turno no vende. Pero
   * **cotizar no exige caja**, así que la pantalla de cotización necesita otra
   * forma de decir "desde acá" — la misma que usa `POST /pos/quotes`: el
   * almacén asignado del cotizador, o uno elegido dentro de su alcance.
   *
   * Se valida contra el ALCANCE del usuario igual que en cualquier otro lado:
   * poder nombrar un almacén no es poder consultarlo.
   */
  warehouseId: z.string().uuid().optional(),
});

export type LookupQuery = z.infer<typeof lookupQuerySchema>;
