import { api } from "@/lib/api";

/** Espejo de los DTO de `apps/api/src/modules/warehouses` (F2-WH-01). */
export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

export interface CreateWarehouseInput {
  name: string;
  address?: string;
}

export interface UpdateWarehouseInput {
  name?: string;
  address?: string | null;
  isActive?: boolean;
}

export async function listWarehouses(): Promise<Warehouse[]> {
  const { data } = await api.get<Warehouse[]>("/warehouses");
  return data;
}

export async function createWarehouse(input: CreateWarehouseInput): Promise<Warehouse> {
  const { data } = await api.post<Warehouse>("/warehouses", input);
  return data;
}

export async function updateWarehouse(id: string, input: UpdateWarehouseInput): Promise<Warehouse> {
  const { data } = await api.patch<Warehouse>(`/warehouses/${id}`, input);
  return data;
}
