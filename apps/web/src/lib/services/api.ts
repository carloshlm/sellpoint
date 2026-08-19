import { api } from "@/lib/api";

/** Espejo del `ServiceSummary` del API (F3-SVC-03). */
export interface Service {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** String y no number: un Decimal serializado a number pierde precisión. */
  cost: string | null;
  price: string | null;
  isActive: boolean;
}

export interface CreateServiceInput {
  code: string;
  name: string;
  description?: string;
  cost?: number;
  price?: number;
}

export interface UpdateServiceInput {
  code?: string;
  name?: string;
  description?: string | null;
  cost?: number | null;
  price?: number | null;
  isActive?: boolean;
}

export async function listServices(params: { query?: string } = {}): Promise<Service[]> {
  const { data } = await api.get<Service[]>("/services", {
    params: params.query ? { query: params.query } : undefined,
  });
  return data;
}

export async function createService(input: CreateServiceInput): Promise<Service> {
  const { data } = await api.post<Service>("/services", input);
  return data;
}

export async function updateService(id: string, input: UpdateServiceInput): Promise<Service> {
  const { data } = await api.patch<Service>(`/services/${id}`, input);
  return data;
}

export async function removeService(id: string): Promise<void> {
  await api.delete(`/services/${id}`);
}
