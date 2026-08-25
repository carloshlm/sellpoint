import { api } from "@/lib/api";

/**
 * Espejo EXACTO de los DTO del motor de catálogos (F2-CAT-01..06). Mismo
 * criterio que `lib/rbac/api.ts`: tipos + fetchers, sin lógica de React acá.
 */

export type FieldType = "text" | "number" | "lookup";

export interface CatalogSummary {
  id: string;
  name: string;
  systemKey: string | null;
  isSystem: boolean;
  isActive: boolean;
}

export interface CatalogField {
  id: string;
  catalogId: string;
  key: string;
  label: string;
  fieldType: FieldType;
  lookupCatalogId: string | null;
  required: boolean;
  position: number;
  isArchived: boolean;
}

export interface CatalogRecord {
  id: string;
  catalogId: string;
  code: string;
  attributes: Record<string, unknown>;
  isActive: boolean;
}

/** Opción de un picker de lookup: el código identifica, el display explica. */
export interface LookupOption {
  id: string;
  code: string;
  display: string;
}

export interface CreateCatalogInput {
  name: string;
}

export interface UpdateCatalogInput {
  name?: string;
  isActive?: boolean;
}

export interface CreateFieldInput {
  label: string;
  fieldType: FieldType;
  lookupCatalogId?: string;
  required: boolean;
}

export interface UpdateFieldInput {
  label?: string;
  fieldType?: FieldType;
  lookupCatalogId?: string | null;
  required?: boolean;
  position?: number;
  isArchived?: boolean;
}

export interface CreateRecordInput {
  code: string;
  attributes: Record<string, unknown>;
}

export interface UpdateRecordInput {
  code?: string;
  attributes?: Record<string, unknown>;
  isActive?: boolean;
}

/** Lo que devuelve DELETE de un campo: si tenía datos, se archivó. */
export interface FieldRemovalResult {
  archived: boolean;
}

export async function listCatalogs(): Promise<CatalogSummary[]> {
  const { data } = await api.get<CatalogSummary[]>("/catalogs");
  return data;
}

export async function createCatalog(input: CreateCatalogInput): Promise<CatalogSummary> {
  const { data } = await api.post<CatalogSummary>("/catalogs", input);
  return data;
}

export async function updateCatalog(
  id: string,
  input: UpdateCatalogInput,
): Promise<CatalogSummary> {
  const { data } = await api.patch<CatalogSummary>(`/catalogs/${id}`, input);
  return data;
}

export async function listFields(catalogId: string): Promise<CatalogField[]> {
  const { data } = await api.get<CatalogField[]>(`/catalogs/${catalogId}/fields`);
  return data;
}

export async function createField(
  catalogId: string,
  input: CreateFieldInput,
): Promise<CatalogField> {
  const { data } = await api.post<CatalogField>(`/catalogs/${catalogId}/fields`, input);
  return data;
}

export async function updateField(
  catalogId: string,
  fieldId: string,
  input: UpdateFieldInput,
): Promise<CatalogField> {
  const { data } = await api.patch<CatalogField>(`/catalogs/${catalogId}/fields/${fieldId}`, input);
  return data;
}

/**
 * Quitar un campo. Sin `confirm`, el API responde 409 con `recordCount` si el
 * campo tiene datos — la UI muestra el diálogo y reintenta con `confirm`.
 */
export async function removeField(
  catalogId: string,
  fieldId: string,
  confirm = false,
): Promise<FieldRemovalResult> {
  const { data } = await api.delete<FieldRemovalResult>(
    `/catalogs/${catalogId}/fields/${fieldId}`,
    { params: confirm ? { confirm: "true" } : undefined },
  );
  return data;
}

export interface RecordsPage {
  rows: CatalogRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listRecords(catalogId: string, page = 1): Promise<RecordsPage> {
  const { data } = await api.get<RecordsPage>(`/catalogs/${catalogId}/records`, {
    params: { page },
  });
  return data;
}

export async function listLookupOptions(
  catalogId: string,
  query?: string,
): Promise<LookupOption[]> {
  const { data } = await api.get<LookupOption[]>(`/catalogs/${catalogId}/records/options`, {
    params: query ? { query } : undefined,
  });
  return data;
}

export async function createRecord(
  catalogId: string,
  input: CreateRecordInput,
): Promise<CatalogRecord> {
  const { data } = await api.post<CatalogRecord>(`/catalogs/${catalogId}/records`, input);
  return data;
}

export async function updateRecord(
  catalogId: string,
  recordId: string,
  input: UpdateRecordInput,
): Promise<CatalogRecord> {
  const { data } = await api.patch<CatalogRecord>(
    `/catalogs/${catalogId}/records/${recordId}`,
    input,
  );
  return data;
}
