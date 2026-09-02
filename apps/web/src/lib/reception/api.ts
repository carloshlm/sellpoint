import { api } from "@/lib/api";

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
