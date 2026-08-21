import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CashboxSession,
  type CreateQuoteInput,
  type CreateSaleInput,
  cancelQuote,
  cancelSale,
  closeSession,
  createQuote,
  createSale,
  getQuoteForSale,
  getSession,
  getSessionTotals,
  type ListQuotesQuery,
  type ListSalesQuery,
  type LookupResult,
  listQuotes,
  listSales,
  lookup,
  openSession,
  type Quote,
  type QuoteForSale,
  type QuotesPage,
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
export function useLookup(q: string, enabled: boolean, warehouseId?: string) {
  const termino = q.trim();
  return useQuery<LookupResult, ApiError>({
    // El almacén entra en la CLAVE: la misma búsqueda contra dos bodegas son
    // dos respuestas distintas, y compartir caché entre ellas ofrecería stock
    // de una sucursal en la otra.
    queryKey: [...POS_SESSION_KEY, "lookup", termino, warehouseId ?? null],
    queryFn: () => lookup(termino, warehouseId),
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

export const POS_QUOTES_KEY = ["pos", "quotes"] as const;

export function useQuotes(query: ListQuotesQuery) {
  return useQuery<QuotesPage, ApiError>({
    queryKey: [...POS_QUOTES_KEY, query],
    queryFn: () => listQuotes(query),
  });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  return useMutation<Quote, ApiError, CreateQuoteInput>({
    mutationFn: (input) => createQuote(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: POS_QUOTES_KEY }),
  });
}

export function useCancelQuote() {
  const queryClient = useQueryClient();
  return useMutation<Quote, ApiError, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) => cancelQuote(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: POS_QUOTES_KEY }),
  });
}

/**
 * F4-QUOTE-04 — la cotización lista para cobrar.
 *
 * `retry: false` a propósito: los errores que devuelve son de NEGOCIO —el folio
 * no existe, ya se cargó, ya se canceló— y reintentarlos no cambia la
 * respuesta, solo retrasa el momento en que el cajero lee qué pasó.
 *
 * `staleTime: 0`: los precios y la disponibilidad se recalculan en cada
 * consulta. Servir una respuesta cacheada acá mostraría un stock de hace un
 * minuto justo en la pantalla que existe para decir la verdad de HOY.
 */
export function useQuoteForSale(folio: string) {
  return useQuery<QuoteForSale, ApiError>({
    queryKey: [...POS_QUOTES_KEY, "for-sale", folio],
    queryFn: () => getQuoteForSale(folio),
    enabled: folio.trim() !== "",
    retry: false,
    staleTime: 0,
  });
}
