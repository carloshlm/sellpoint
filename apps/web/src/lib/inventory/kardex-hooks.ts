import { useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  getInTransit,
  getKardex,
  getStock,
  type InTransitRow,
  type KardexPage,
  type KardexParams,
  type StockSummary,
} from "./kardex-api";

export const KARDEX_QUERY_KEY = ["inventory", "kardex"] as const;
export const STOCK_QUERY_KEY = ["inventory", "stock"] as const;

export function useKardex(productId: string | undefined, params: KardexParams) {
  return useQuery<KardexPage, ApiError>({
    queryKey: [...KARDEX_QUERY_KEY, productId, params],
    queryFn: () => getKardex(productId as string, params),
    enabled: productId !== undefined,
    // El server pagina: sin esto la tabla parpadearía al cambiar de filtro.
    placeholderData: (previous) => previous,
  });
}

export function useStock(productId: string | undefined) {
  return useQuery<StockSummary, ApiError>({
    queryKey: [...STOCK_QUERY_KEY, productId],
    queryFn: () => getStock(productId as string),
    enabled: productId !== undefined,
  });
}

export function useInTransit(productId: string | undefined) {
  return useQuery<{ rows: InTransitRow[] }, ApiError>({
    queryKey: [...STOCK_QUERY_KEY, "in-transit", productId],
    queryFn: () => getInTransit(productId as string),
    enabled: productId !== undefined,
  });
}
