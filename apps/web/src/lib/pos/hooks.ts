import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CashboxSession,
  type CreateSaleInput,
  cancelSale,
  closeSession,
  createSale,
  getSession,
  getSessionTotals,
  type ListSalesQuery,
  type LookupResult,
  listSales,
  lookup,
  openSession,
  type Sale,
  type SalesPage,
  type SessionTotal,
} from "./api";

export const POS_SESSION_KEY = ["pos", "session"] as const;

export function useSession() {
  return useQuery<{ session: CashboxSession | null }, ApiError>({
    queryKey: POS_SESSION_KEY,
    queryFn: getSession,
  });
}

/**
 * Los totales solo tienen sentido con un turno abierto: sin él, el API
 * devuelve una lista vacía y consultarlo sería una llamada de más en cada
 * render de la pantalla de venta.
 */
export function useSessionTotals(enabled: boolean) {
  return useQuery<{ totals: SessionTotal[] }, ApiError>({
    queryKey: [...POS_SESSION_KEY, "totals"],
    queryFn: getSessionTotals,
    enabled,
  });
}

export function useOpenSession() {
  const queryClient = useQueryClient();
  return useMutation<CashboxSession, ApiError, string | undefined>({
    // Envuelto y no `mutationFn: openSession` a propósito: pasado directo,
    // React Query le manda el CONTEXTO como segundo argumento (gotcha ya
    // documentado en `movements-documents.test.tsx`).
    mutationFn: (warehouseId) => openSession(warehouseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: POS_SESSION_KEY }),
  });
}

export function useCloseSession() {
  const queryClient = useQueryClient();
  return useMutation<
    { session: CashboxSession; totals: SessionTotal[] },
    ApiError,
    { declaredCash: number; note?: string }
  >({
    mutationFn: (input) => closeSession(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: POS_SESSION_KEY }),
  });
}

/**
 * F4-CART-01 — la búsqueda del mostrador.
 *
 * `enabled` con dos condiciones: hay texto y hay turno. Sin turno el API
 * responde 409, así que consultarlo sería pedirle a React Query que reintente
 * un error que ya sabemos que va a llegar.
 *
 * `staleTime` corto y no cero: el cajero teclea y borra sobre el mismo input, y
 * volver a la consulta anterior tiene que ser instantáneo. Corto, porque el
 * stock se mueve — una respuesta de hace un minuto ya puede estar ofreciendo lo
 * último que se vendió.
 */
export function useLookup(q: string, enabled: boolean) {
  const termino = q.trim();
  return useQuery<LookupResult, ApiError>({
    queryKey: [...POS_SESSION_KEY, "lookup", termino],
    queryFn: () => lookup(termino),
    enabled: enabled && termino.length > 0,
    staleTime: 10_000,
  });
}

/**
 * F4-UI-02 — cobrar.
 *
 * La clave de idempotencia la manda QUIEN LLAMA, no este hook: tiene que nacer
 * cuando se abre el modal y sobrevivir a los reintentos. Si el hook la generara,
 * cada intento traería una distinta y la protección contra el doble tap se
 * evaporaría sin que nadie lo notara hasta ver dos folios por una sola venta.
 *
 * Al terminar se invalida el turno: los totales del arqueo cambiaron.
 */
export function useCreateSale() {
  const queryClient = useQueryClient();
  return useMutation<Sale, ApiError, { input: CreateSaleInput; idempotencyKey: string }>({
    mutationFn: ({ input, idempotencyKey }) => createSale(input, idempotencyKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: POS_SESSION_KEY }),
  });
}

export const POS_SALES_KEY = ["pos", "sales"] as const;

/** F4-UI-03 — el historial. Las anuladas vienen marcadas, no escondidas. */
export function useSales(query: ListSalesQuery) {
  return useQuery<SalesPage, ApiError>({
    queryKey: [...POS_SALES_KEY, query],
    queryFn: () => listSales(query),
  });
}

/**
 * Anular.
 *
 * Invalida el historial Y el turno: el arqueo cambia, porque una venta anulada
 * deja de sumar al total del cajón. Olvidar lo segundo dejaría la pantalla de
 * cierre contando dinero que ya no está.
 */
export function useCancelSale() {
  const queryClient = useQueryClient();
  return useMutation<Sale, ApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => cancelSale(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: POS_SALES_KEY });
      void queryClient.invalidateQueries({ queryKey: POS_SESSION_KEY });
    },
  });
}
