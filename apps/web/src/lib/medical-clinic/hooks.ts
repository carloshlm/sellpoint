import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import type { DashboardPeriod } from "@/lib/dashboard/api";
import type { CreateCustomerInput, Customer } from "@/lib/reception/api";
import {
  type ClinicTop,
  type CreateOrderInput,
  type CreateStudyInput,
  cancelOrder,
  closeRecord,
  createOrder,
  createPatient,
  createRecord,
  createStudy,
  getClinicTop,
  getPatient,
  getRecord,
  getSettings,
  type ListRecordsParams,
  listOrders,
  listRecords,
  listStudies,
  type MedicalClinicSettings,
  type MedicalOrder,
  type MedicalRecord,
  type PatientHit,
  type PatientSummary,
  type RecordsPage,
  removeStudy,
  type SectionView,
  type StudiesPage,
  type Study,
  type StudyKind,
  saveSection,
  searchPatients,
  searchStock,
  type UpdateStudyInput,
  updateSettings,
  updateStudy,
} from "./api";

const RAIZ = ["medical-clinic"] as const;
export const studiesKey = (kind: StudyKind) => [...RAIZ, "studies", kind] as const;
export const recordKey = (recordId: string) => [...RAIZ, "records", recordId] as const;
export const SETTINGS_KEY = [...RAIZ, "settings"] as const;

// ── Catálogos ─────────────────────────────────────────────────────────
/**
 * El catálogo de estudios. `enabled` en falso deja la consulta quieta: el
 * buscador de una orden no pide el catálogo entero mientras nadie escribe
 * (Carlos, 2026-09-04), pero la pantalla del catálogo sí lo lista de entrada.
 */
export function useStudies(
  kind: StudyKind,
  params: { query?: string; page?: number } = {},
  enabled = true,
) {
  return useQuery<StudiesPage, ApiError>({
    queryKey: [...studiesKey(kind), params],
    queryFn: () => listStudies(kind, params),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useCreateStudy(kind: StudyKind) {
  const queryClient = useQueryClient();
  return useMutation<Study, ApiError, CreateStudyInput>({
    mutationFn: (input) => createStudy(kind, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studiesKey(kind) });
    },
  });
}

export function useUpdateStudy(kind: StudyKind) {
  const queryClient = useQueryClient();
  return useMutation<Study, ApiError, { id: string; input: UpdateStudyInput }>({
    mutationFn: ({ id, input }) => updateStudy(kind, id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studiesKey(kind) });
    },
  });
}

export function useRemoveStudy(kind: StudyKind) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => removeStudy(kind, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studiesKey(kind) });
    },
  });
}

// ── Configuración ─────────────────────────────────────────────────────
export function useMedicalClinicSettings(enabled = true) {
  return useQuery<MedicalClinicSettings, ApiError>({
    queryKey: SETTINGS_KEY,
    queryFn: getSettings,
    enabled,
  });
}

export function useUpdateMedicalClinicSettings() {
  const queryClient = useQueryClient();
  return useMutation<MedicalClinicSettings, ApiError, Partial<MedicalClinicSettings>>({
    mutationFn: (input) => updateSettings(input),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
    },
  });
}

// ── Pacientes y expedientes ───────────────────────────────────────────
export function usePatientSearch(params: { mode: "name" | "turn"; q: string }, enabled: boolean) {
  return useQuery<PatientHit[], ApiError>({
    queryKey: [...RAIZ, "patients", "search", params],
    queryFn: () => searchPatients(params),
    enabled: enabled && params.q.trim().length > 0,
  });
}

export function useCreatePatient() {
  return useMutation<Customer, ApiError, CreateCustomerInput>({
    mutationFn: (input) => createPatient(input),
  });
}

export function useCreateRecord() {
  return useMutation<MedicalRecord, ApiError, { customerId: string; turnId?: string }>({
    mutationFn: (input) => createRecord(input),
  });
}

export function useRecord(recordId: string) {
  return useQuery<MedicalRecord, ApiError>({
    queryKey: recordKey(recordId),
    queryFn: () => getRecord(recordId),
  });
}

export function useSaveSection(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation<SectionView, ApiError, { key: string; data: Record<string, unknown> }>({
    mutationFn: ({ key, data }) => saveSection(recordId, key, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordKey(recordId) });
    },
  });
}

export function useCloseRecord(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation<MedicalRecord, ApiError, void>({
    mutationFn: () => closeRecord(recordId),
    onSuccess: (data) => {
      queryClient.setQueryData(recordKey(recordId), data);
    },
  });
}

// ── Órdenes ───────────────────────────────────────────────────────────
export const ordersKey = (recordId: string) => [...recordKey(recordId), "orders"] as const;

export function useOrders(recordId: string) {
  return useQuery<MedicalOrder[], ApiError>({
    queryKey: ordersKey(recordId),
    queryFn: () => listOrders(recordId),
  });
}

export function useCreateOrder(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation<MedicalOrder, ApiError, CreateOrderInput>({
    mutationFn: (input) => createOrder(recordId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordKey(recordId) });
      void queryClient.invalidateQueries({ queryKey: ordersKey(recordId) });
    },
  });
}

export function useCancelOrder(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation<MedicalOrder, ApiError, string>({
    mutationFn: (id) => cancelOrder(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordKey(recordId) });
      void queryClient.invalidateQueries({ queryKey: ordersKey(recordId) });
    },
  });
}

export function useStockSearch(q: string, enabled = true) {
  const termino = q.trim();
  return useQuery({
    queryKey: [...RAIZ, "stock", termino],
    queryFn: () => searchStock(termino),
    enabled: enabled && termino.length > 0,
    staleTime: 10_000,
  });
}

/**
 * Lo más vendido del consultorio. `enabled` en falso —sin el módulo o sin
 * permiso de lectura— deja la consulta quieta: pedir un 402 o un 403 para
 * después esconder la tarjeta es gastar una llamada en confirmar lo que ya
 * sabemos desde el token.
 */
export function useClinicTop(period: DashboardPeriod, enabled: boolean) {
  return useQuery<ClinicTop, ApiError>({
    queryKey: [...RAIZ, "dashboard", "top", period],
    queryFn: () => getClinicTop(period),
    enabled,
  });
}

// ── Historias clínicas ────────────────────────────────────────────────
export const RECORDS_LIST_KEY = [...RAIZ, "records", "list"] as const;

/** El buscador de historias clínicas: por nombre, fechas o paciente. */
export function useRecords(params: ListRecordsParams, enabled = true) {
  return useQuery<RecordsPage, ApiError>({
    queryKey: [...RECORDS_LIST_KEY, params],
    queryFn: () => listRecords(params),
    enabled,
  });
}

export const patientKey = (customerId: string) => [...RAIZ, "patients", customerId] as const;

/** El resumen del paciente (F9-CLINIC-32). */
export function usePatient(customerId: string) {
  return useQuery<PatientSummary, ApiError>({
    queryKey: patientKey(customerId),
    queryFn: () => getPatient(customerId),
  });
}
