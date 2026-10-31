import { api } from "@/lib/api";

/** Espejo del `SupplierSummary` del API (F9-SUPPL-03). */
export interface Supplier {
  id: string;
  /** F9-SUPPCAT-03: la llave visible, única por negocio, en mayúsculas. */
  code: string;
  name: string;
  taxId: string | null;
  /** El contacto 1 (el principal) vive en las columnas del proveedor: la lista lo muestra. */
  contactName: string | null;
  /** «Puesto / Cargo» del contacto 1. */
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
  /** La dirección en los campos del país del negocio, como Sucursales: `address` es «Calle y número». */
  address: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  notes: string | null;
  /** F9-SUPPCAT-05: los campos propios del catálogo de proveedores. */
  attributes: Record<string, unknown>;
  /** Los contactos adicionales (Contacto 2, 3…), en el orden en que se capturaron. */
  contacts: SupplierContact[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Un contacto adicional del proveedor, como lo devuelve el API. */
export interface SupplierContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
}

/** Un contacto adicional como viaja al API: el orden del arreglo es su orden. */
export interface SupplierContactInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string | null;
}

export interface CreateSupplierInput {
  /** Opcional: si no viaja, el API genera `PROV-NNN`. */
  code?: string;
  name: string;
  taxId?: string;
  contactName?: string;
  jobTitle?: string;
  phone?: string;
  email?: string;
  address?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  notes?: string;
  attributes?: Record<string, unknown>;
  contacts?: SupplierContactInput[];
}

/** Presente = cambia; `null` = se limpia; ausente = no se toca. */
export interface UpdateSupplierInput {
  code?: string;
  name?: string;
  taxId?: string | null;
  contactName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  notes?: string | null;
  attributes?: Record<string, unknown>;
  /** Presente REEMPLAZA todos los contactos adicionales; ausente = no se tocan. */
  contacts?: SupplierContactInput[];
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
