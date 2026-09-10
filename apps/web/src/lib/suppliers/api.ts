import { api } from "@/lib/api";

/** Espejo del `SupplierSummary` del API (F9-SUPPL-03). */
export interface Supplier {
  id: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierInput {
  name: string;
  taxId?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

/** Presente = cambia; `null` = se limpia; ausente = no se toca. */
export interface UpdateSupplierInput {
  name?: string;
  taxId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface SuppliersPage {
  rows: Supplier[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListSuppliersParams {
  query?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listSuppliers(params: ListSuppliersParams = {}): Promise<SuppliersPage> {
  const { data } = await api.get<SuppliersPage>("/suppliers", {
    params: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.isActive !== undefined ? { isActive: String(params.isActive) } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    },
  });
  return data;
}

export async function getSupplier(id: string): Promise<Supplier> {
  const { data } = await api.get<Supplier>(`/suppliers/${id}`);
  return data;
}

export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  const { data } = await api.post<Supplier>("/suppliers", input);
  return data;
}

export async function updateSupplier(id: string, input: UpdateSupplierInput): Promise<Supplier> {
  const { data } = await api.patch<Supplier>(`/suppliers/${id}`, input);
  return data;
}

export async function removeSupplier(id: string): Promise<void> {
  await api.delete(`/suppliers/${id}`);
}
