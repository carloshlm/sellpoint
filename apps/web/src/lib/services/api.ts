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
  /** F3-SVC-07. En qué almacenes se ofrece. Vacío = no se vende en ninguno. */
  warehouseIds: string[];
  /** Campos dinámicos del catálogo de sistema "services" (2026-08-26). */
  attributes: Record<string, unknown>;
}

export interface CreateServiceInput {
  code: string;
  name: string;
  description?: string;
  cost?: number;
  price?: number;
  /** Requerido: olvidarlo crearía un servicio invendible en silencio. */
  warehouseIds: string[];
  attributes?: Record<string, unknown>;
}

export interface UpdateServiceInput {
  code?: string;
  name?: string;
  description?: string | null;
  cost?: number | null;
  price?: number | null;
  isActive?: boolean;
  /** Presente = reemplazo completo del set. Ausente = no tocar. */
  warehouseIds?: string[];
  attributes?: Record<string, unknown>;
}

export interface ServicesPage {
  rows: Service[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listServices(
  params: { query?: string; page?: number; pageSize?: number } = {},
): Promise<ServicesPage> {
  const { data } = await api.get<ServicesPage>("/services", {
    params: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    },
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
