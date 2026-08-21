import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CashboxSession,
  closeSession,
  getSession,
  getSessionTotals,
  openSession,
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
