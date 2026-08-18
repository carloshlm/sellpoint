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

/**
 * `scoped` acota a los almacenes ACTIVOS dentro del alcance del usuario — lo
 * que consumen los selectores de la Fase 3. Sin el flag lista todos, que es lo
 * que necesita la pantalla de administración de almacenes.
 */
export async function listWarehouses(options: { scoped?: boolean } = {}): Promise<Warehouse[]> {
  const { data } = await api.get<Warehouse[]>("/warehouses", {
    params: options.scoped === true ? { scoped: true } : {},
  });
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
