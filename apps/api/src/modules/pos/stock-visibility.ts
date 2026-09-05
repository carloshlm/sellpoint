import type { LookupItem, LookupProductItem } from "./lookup.strategies";

/**
 * F4-POSVIS — «Mostrar existencias en el punto de venta» (Carlos, 2026-09-04).
 *
 * Responde una pregunta distinta de «Vender sin existencias»: aquella decide
 * si se PUEDE cobrar de más (y la aplica el cobro); esta, si el vendedor VE
 * cuánto hay. Apagada, el API no manda la existencia al punto de venta:
 * `available` y `expired` viajan en `null`. No basta esconderlo en pantalla:
 * lo que viaja por la red se lee con la pestaña abierta.
 *
 * Solo aplica al camino del POS (`searchForPos`, `forSale`). El buscador de
 * medicamentos del consultorio comparte `LookupService.search` y NO pasa por
 * aquí: quien mira es el médico.
 */
export type PosLookupProductItem = Omit<LookupProductItem, "available" | "expired"> & {
  available: string | null;
  expired: string | null;
};
export type PosLookupItem = Exclude<LookupItem, LookupProductItem> | PosLookupProductItem;

export function hideStockFromItem(item: LookupItem): PosLookupItem {
  if (item.type !== "product") {
    return item;
  }
  return { ...item, available: null, expired: null };
}

export function hideStock(items: LookupItem[]): PosLookupItem[] {
  return items.map(hideStockFromItem);
}
