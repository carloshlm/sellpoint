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
});

export type LookupQuery = z.infer<typeof lookupQuerySchema>;
