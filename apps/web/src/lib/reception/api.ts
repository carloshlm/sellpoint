import { api } from "@/lib/api";
import { imprimirPdf } from "@/lib/download";

/** Espejo del `CustomerSummary` del API (F9-RECEP-06). La edad viene CALCULADA. */
export interface Customer {
  id: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  /** `YYYY-MM-DD` o null. */
  birthDate: string | null;
  /** Años cumplidos hoy en el calendario del negocio; null sin fecha. */
  age: number | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

/** Presente = cambia; `null` = se limpia; ausente = no se toca. */
export interface UpdateCustomerInput {
  firstName?: string;
  lastNamePaternal?: string;
  lastNameMaternal?: string | null;
  birthDate?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface CustomersPage {
  rows: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

export type TurnStatus = "waiting" | "attended";

/** Espejo del `TurnSummary` del API (F9-RECEP-07). */
export interface Turn {
  id: string;
  number: number;
  /** El día del negocio, `YYYY-MM-DD`. */
  businessDate: string;
  customerId: string | null;
  customerName: string | null;
  status: TurnStatus;
  attendedAt: string | null;
  createdAt: string;
}

export async function listCustomers(
  params: { query?: string; page?: number; pageSize?: number } = {},
): Promise<CustomersPage> {
  const { data } = await api.get<CustomersPage>("/reception/customers", {
    params: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    },
  });
  return data;
}

export async function getCustomer(id: string): Promise<Customer> {
  const { data } = await api.get<Customer>(`/reception/customers/${id}`);
  return data;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const { data } = await api.post<Customer>("/reception/customers", input);
  return data;
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
  const { data } = await api.patch<Customer>(`/reception/customers/${id}`, input);
  return data;
}

export async function removeCustomer(id: string): Promise<void> {
  await api.delete(`/reception/customers/${id}`);
}

export async function listTurns(params: { date?: string } = {}): Promise<Turn[]> {
  const { data } = await api.get<Turn[]>("/reception/turns", {
    params: params.date ? { date: params.date } : {},
  });
  return data;
}

export async function createTurn(input: { customerId?: string } = {}): Promise<Turn> {
  const { data } = await api.post<Turn>("/reception/turns", input);
  return data;
}

export async function attendTurn(id: string): Promise<Turn> {
  const { data } = await api.post<Turn>(`/reception/turns/${id}/attend`, {});
  return data;
}

export async function waitTurn(id: string): Promise<Turn> {
  const { data } = await api.post<Turn>(`/reception/turns/${id}/wait`, {});
  return data;
}

/**
 * El papel del turno: PDF térmico del servidor (58 mm por defecto) que va
 * directo al cuadro de impresión, sin pestaña nueva. Fallar no pierde nada:
 * el turno ya existe y se vuelve a pedir con un clic.
 */
export async function printTurnTicket(
  id: string,
  number: number,
  width: "58mm" | "80mm" = "58mm",
): Promise<void> {
  const { data } = await api.get<Blob>(`/reception/turns/${id}/ticket`, {
    responseType: "blob",
    params: { width },
  });
  imprimirPdf(data, `turno-${number}.pdf`);
}
