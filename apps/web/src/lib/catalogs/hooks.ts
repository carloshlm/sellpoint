import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CatalogField,
  type CatalogRecord,
  type CatalogSummary,
  type CreateCatalogInput,
  type CreateFieldInput,
  type CreateRecordInput,
  createCatalog,
  createField,
  createRecord,
  deleteRecord,
  type LookupOption,
  listCatalogs,
  listFields,
  listLookupOptions,
  listRecords,
  type RecordsPage,
  removeField,
  type UpdateCatalogInput,
  type UpdateFieldInput,
  type UpdateRecordInput,
  updateCatalog,
  updateField,
  updateRecord,
} from "./api";

/**
 * Queries y mutaciones del motor de catálogos. La invalidación vive DENTRO
 * del hook, igual que en `lib/rbac/hooks.ts` (D3 del design de f1-web-users):
 * es una consecuencia de la mutación, no un paso que un container futuro
 * pueda olvidar repetir.
 */

export const CATALOGS_QUERY_KEY = ["catalogs"] as const;

export function fieldsQueryKey(catalogId: string) {
  return ["catalogs", catalogId, "fields"] as const;
}

export function recordsQueryKey(catalogId: string) {
  return ["catalogs", catalogId, "records"] as const;
}

export function lookupOptionsQueryKey(catalogId: string, query: string) {
  return ["catalogs", catalogId, "options", query] as const;
}

export function useCatalogs() {
  return useQuery<CatalogSummary[], ApiError>({
    queryKey: CATALOGS_QUERY_KEY,
    queryFn: listCatalogs,
  });
}

export function useCreateCatalog() {
  const queryClient = useQueryClient();
  return useMutation<CatalogSummary, ApiError, CreateCatalogInput>({
    mutationFn: createCatalog,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOGS_QUERY_KEY });
    },
  });
}

export function useUpdateCatalog() {
  const queryClient = useQueryClient();
  return useMutation<CatalogSummary, ApiError, { id: string; input: UpdateCatalogInput }>({
    mutationFn: ({ id, input }) => updateCatalog(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOGS_QUERY_KEY });
    },
  });
}

export function useCatalogFields(catalogId: string | undefined) {
  return useQuery<CatalogField[], ApiError>({
    queryKey: fieldsQueryKey(catalogId ?? ""),
    queryFn: () => listFields(catalogId as string),
    enabled: Boolean(catalogId),
  });
}

export function useCreateField(catalogId: string) {
  const queryClient = useQueryClient();
  return useMutation<CatalogField, ApiError, CreateFieldInput>({
    mutationFn: (input) => createField(catalogId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fieldsQueryKey(catalogId) });
    },
  });
}

export function useUpdateField(catalogId: string) {
  const queryClient = useQueryClient();
  return useMutation<CatalogField, ApiError, { fieldId: string; input: UpdateFieldInput }>({
    mutationFn: ({ fieldId, input }) => updateField(catalogId, fieldId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fieldsQueryKey(catalogId) });
    },
  });
}

export function useRemoveField(catalogId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ archived: boolean }, ApiError, { fieldId: string; confirm?: boolean }>({
    mutationFn: ({ fieldId, confirm }) => removeField(catalogId, fieldId, confirm),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fieldsQueryKey(catalogId) });
    },
  });
}

export function useCatalogRecords(catalogId: string | undefined, page = 1) {
  return useQuery<RecordsPage, ApiError>({
    queryKey: [...recordsQueryKey(catalogId ?? ""), page],
    queryFn: () => listRecords(catalogId as string, page),
    enabled: Boolean(catalogId),
    placeholderData: (previous) => previous,
  });
}

/**
 * Opciones de un picker de lookup. `enabled` cuelga del catálogo destino:
 * mientras el campo no declare a dónde apunta, no hay nada que pedir.
 */
export function useLookupOptions(catalogId: string | undefined, query = "") {
  return useQuery<LookupOption[], ApiError>({
    queryKey: lookupOptionsQueryKey(catalogId ?? "", query),
    queryFn: () => listLookupOptions(catalogId as string, query || undefined),
    enabled: Boolean(catalogId),
  });
}

export function useCreateRecord(catalogId: string) {
  const queryClient = useQueryClient();
  return useMutation<CatalogRecord, ApiError, CreateRecordInput>({
    mutationFn: (input) => createRecord(catalogId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordsQueryKey(catalogId) });
    },
  });
}

export function useUpdateRecord(catalogId: string) {
  const queryClient = useQueryClient();
  return useMutation<CatalogRecord, ApiError, { recordId: string; input: UpdateRecordInput }>({
    mutationFn: ({ recordId, input }) => updateRecord(catalogId, recordId, input),
    onSuccess: () => {
      // También las opciones de lookup: archivar un registro lo saca del
      // picker de cualquier campo que apunte a este catálogo.
      void queryClient.invalidateQueries({ queryKey: ["catalogs", catalogId] });
    },
  });
}

export function useDeleteRecord(catalogId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (recordId) => deleteRecord(catalogId, recordId),
    onSuccess: () => {
      // También las opciones de lookup: el registro borrado no debe seguir
      // ofreciéndose en el picker de ningún campo que apunte acá.
      void queryClient.invalidateQueries({ queryKey: ["catalogs", catalogId] });
    },
  });
}
