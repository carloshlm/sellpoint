import { api } from "@/lib/api";

/** Espejo de los DTO de `apps/api/src/modules/warehouses` (F2-WH-01). */
export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  /** E.164 canónico; el form lo pinta como país + número (2026-08-26). */
  phone: string | null;
  email: string | null;
  /** Campos dinámicos del catálogo de sistema "warehouses". */
  attributes: Record<string, unknown>;
  isActive: boolean;
  /**
   * F3-GUARDS-03. Por qué NO se puede desactivar, o `null` si sí se puede.
   * Llega en el listado para que el botón se deshabilite antes del clic en vez
   * de mandar al usuario a chocar con un 409.
   */
  deactivationBlockedBy: "stock" | "transfers_in_transit" | null;
}

export interface CreateWarehouseInput {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  attributes?: Record<string, unknown>;
}

export interface UpdateWarehouseInput {
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  attributes?: Record<string, unknown>;
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

// 204 sin body: solo un almacén que nunca operó se puede borrar — con
// historia el API contesta 409 `warehouses.has_history` y la salida es
// desactivarlo.
export async function deleteWarehouse(id: string): Promise<void> {
  await api.delete(`/warehouses/${id}`);
}
