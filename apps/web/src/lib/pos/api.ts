import type { PaymentMethod } from "@sellpoint/shared";
import { api } from "@/lib/api";

export interface CashboxSession {
  id: string;
  warehouseId: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  declaredCash: string | null;
  calculatedCash: string | null;
  cashDifference: string | null;
  closingNote: string | null;
  warehouse: { id: string; name: string };
}

/** Lo vendido por método en el turno. `total` es string decimal, como todo el dinero del API. */
export interface SessionTotal {
  method: PaymentMethod;
  total: string;
  count: number;
}

export async function getSession(): Promise<{ session: CashboxSession | null }> {
  const { data } = await api.get<{ session: CashboxSession | null }>("/pos/session");
  return data;
}

export async function openSession(warehouseId?: string): Promise<CashboxSession> {
  const { data } = await api.post<CashboxSession>(
    "/pos/session",
    warehouseId === undefined ? {} : { warehouseId },
  );
  return data;
}

export async function getSessionTotals(): Promise<{ totals: SessionTotal[] }> {
  const { data } = await api.get<{ totals: SessionTotal[] }>("/pos/session/totals");
  return data;
}

export async function closeSession(input: {
  declaredCash: number;
  note?: string;
}): Promise<{ session: CashboxSession; totals: SessionTotal[] }> {
  const { data } = await api.post<{ session: CashboxSession; totals: SessionTotal[] }>(
    "/pos/session/close",
    input,
  );
  return data;
}
