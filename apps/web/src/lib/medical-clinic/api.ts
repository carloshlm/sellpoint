import type { MedicalOrderKind, MedicalRecordSectionGroup } from "@sellpoint/shared";
import { api } from "@/lib/api";
import type { DashboardPeriod } from "@/lib/dashboard/api";
import { imprimirPdf } from "@/lib/download";
import type { LookupProductItem } from "@/lib/pos/api";
import type { CreateCustomerInput, Customer } from "@/lib/reception/api";

/**
 * F9-CLINIC-WEB — el cliente HTTP del Consultorio Médico. Espejo de los
 * summaries del API (`apps/api/src/modules/medical-clinic`).
 */

// ── Catálogos de estudios ─────────────────────────────────────────────
export type StudyKind = "lab" | "diagnostic";

export interface Study {
  id: string;
  code: string;
  name: string;
  description: string | null;
  cost: string | null;
  price: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudiesPage {
  rows: Study[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateStudyInput {
  code: string;
  name: string;
  description?: string;
  cost?: number;
  price?: number;
}

export interface UpdateStudyInput {
  code?: string;
  name?: string;
  description?: string | null;
  cost?: number | null;
  price?: number | null;
  isActive?: boolean;
}

const rutaDe = (kind: StudyKind) => `/medical-clinic/${kind}-studies`;

export async function listStudies(
  kind: StudyKind,
  params: { query?: string; page?: number; pageSize?: number; isActive?: boolean } = {},
): Promise<StudiesPage> {
  const { data } = await api.get<StudiesPage>(rutaDe(kind), {
    params: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
      ...(params.isActive !== undefined ? { isActive: String(params.isActive) } : {}),
    },
  });
  return data;
}

export async function createStudy(kind: StudyKind, input: CreateStudyInput): Promise<Study> {
  const { data } = await api.post<Study>(rutaDe(kind), input);
  return data;
}

export async function updateStudy(
  kind: StudyKind,
  id: string,
  input: UpdateStudyInput,
): Promise<Study> {
  const { data } = await api.patch<Study>(`${rutaDe(kind)}/${id}`, input);
  return data;
}

export async function removeStudy(kind: StudyKind, id: string): Promise<void> {
  await api.delete(`${rutaDe(kind)}/${id}`);
}

// ── Configuración ─────────────────────────────────────────────────────
export interface MedicalClinicSettings {
  sellsMedications: boolean;
  sellsLabStudies: boolean;
  sellsDiagnosticStudies: boolean;
}

export async function getSettings(): Promise<MedicalClinicSettings> {
  const { data } = await api.get<MedicalClinicSettings>("/medical-clinic/settings");
  return data;
}

export async function updateSettings(
  input: Partial<MedicalClinicSettings>,
): Promise<MedicalClinicSettings> {
  const { data } = await api.put<MedicalClinicSettings>("/medical-clinic/settings", input);
  return data;
}

// ── Pacientes ─────────────────────────────────────────────────────────
/** Por qué una consulta ya no acepta captura; `null` = se puede continuar. */
export type RecordLockReason = "closed" | "expired";

export interface PatientHit {
  /** `null` en un turno todavía sin paciente: se da de alta al atenderlo. */
  customerId: string | null;
  name: string;
  age: number | null;
  birthDate: string | null;
  turnNumber: number | null;
  turnId: string | null;
  lastRecord: {
    id: string;
    folio: string;
    consultationDate: string;
    status: "open" | "closed";
    lockReason: RecordLockReason | null;
  } | null;
}

export async function searchPatients(params: {
  mode: "name" | "turn";
  q: string;
}): Promise<PatientHit[]> {
  const { data } = await api.get<PatientHit[]>("/medical-clinic/patients/search", { params });
  return data;
}

/** «Paciente nuevo»: delega en el alta de Recepción, pero con la llave del consultorio. */
export async function createPatient(input: CreateCustomerInput): Promise<Customer> {
  const { data } = await api.post<Customer>("/medical-clinic/patients", input);
  return data;
}

// ── Historia clínica ──────────────────────────────────────────────────
export type SectionStatus = "pending" | "completed";

export interface RecordSection {
  key: string;
  group: MedicalRecordSectionGroup;
  order: number;
  functional: boolean;
  status: SectionStatus;
  data: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface RecordOrderSummary {
  id: string;
  kind: MedicalOrderKind;
  folio: string;
  status: "issued" | "canceled";
  quoteId: string | null;
  createdAt: string;
}

export interface MedicalRecord {
  id: string;
  folio: string;
  status: "open" | "closed";
  /** Lo decide el API con el día del NEGOCIO: el web solo lo pinta. */
  editable: boolean;
  lockReason: RecordLockReason | null;
  consultationDate: string;
  closedAt: string | null;
  turnNumber: number | null;
  patient: {
    customerId: string | null;
    name: string;
    birthDate: string | null;
    sex: "F" | "M" | "X" | null;
    age: number | null;
  };
  doctor: { id: string; name: string };
  sections: RecordSection[];
  orders: RecordOrderSummary[];
  createdAt: string;
}

export async function createRecord(input: {
  customerId: string;
  turnId?: string;
}): Promise<MedicalRecord> {
  const { data } = await api.post<MedicalRecord>("/medical-clinic/records", input);
  return data;
}

export async function getRecord(id: string): Promise<MedicalRecord> {
  const { data } = await api.get<MedicalRecord>(`/medical-clinic/records/${id}`);
  return data;
}

export async function closeRecord(id: string): Promise<MedicalRecord> {
  const { data } = await api.post<MedicalRecord>(`/medical-clinic/records/${id}/close`, {});
  return data;
}

export interface SectionView {
  key: string;
  status: SectionStatus;
  data: Record<string, unknown>;
  updatedAt: string | null;
}

export async function saveSection(
  recordId: string,
  key: string,
  data: Record<string, unknown>,
): Promise<SectionView> {
  const { data: vista } = await api.put<SectionView>(
    `/medical-clinic/records/${recordId}/sections/${key}`,
    data,
  );
  return vista;
}

// ── Órdenes ───────────────────────────────────────────────────────────
export type ChargeStatus = "charged" | "pending" | "not_for_sale";

export interface OrderLine {
  id: string;
  lineNo: number;
  productId: string | null;
  presentationId: string | null;
  labStudyId: string | null;
  diagnosticStudyId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  dosage: string | null;
}

export interface MedicalOrder {
  id: string;
  recordId: string;
  kind: MedicalOrderKind;
  folio: string;
  status: "issued" | "canceled";
  quoteId: string | null;
  quoteFolio: string | null;
  saleId: string | null;
  chargeStatus: ChargeStatus;
  indications: string | null;
  diagnosis: string | null;
  total: string;
  lines: OrderLine[];
  createdAt: string;
  canceledAt: string | null;
}

export type CreateOrderLine =
  | { productId: string; presentationId?: string; quantity: number; dosage?: string }
  | { labStudyId: string; quantity?: number }
  | { diagnosticStudyId: string; quantity?: number };

export interface CreateOrderInput {
  kind: MedicalOrderKind;
  lines: CreateOrderLine[];
  indications?: string;
  diagnosis?: string;
}

export async function createOrder(
  recordId: string,
  input: CreateOrderInput,
): Promise<MedicalOrder> {
  const { data } = await api.post<MedicalOrder>(
    `/medical-clinic/records/${recordId}/orders`,
    input,
  );
  return data;
}

export async function listOrders(recordId: string): Promise<MedicalOrder[]> {
  const { data } = await api.get<MedicalOrder[]>(`/medical-clinic/records/${recordId}/orders`);
  return data;
}

export async function cancelOrder(id: string): Promise<MedicalOrder> {
  const { data } = await api.post<MedicalOrder>(`/medical-clinic/orders/${id}/cancel`, {});
  return data;
}

/** El documento carta de la orden, directo al cuadro de impresión. */
export async function printMedicalOrder(id: string, folio: string): Promise<void> {
  const { data } = await api.get<Blob>(`/medical-clinic/orders/${id}/document`, {
    responseType: "blob",
  });
  imprimirPdf(data, `${folio}.pdf`);
}

// ── Medicamentos del stock del médico ─────────────────────────────────
/** El mismo ítem del buscador del POS, re-exportado: el módulo no importa de `@/lib/pos` en pantallas. */
/**
 * El buscador del médico SIEMPRE trae la existencia: «Mostrar existencias en
 * el punto de venta» (F4-POSVIS) es del POS y no pasa por aquí. El tipo lo
 * dice: `available`/`expired` no admiten null en este contrato.
 */
export type MedicationItem = Omit<LookupProductItem, "available" | "expired"> & {
  available: string;
  expired: string;
};

export async function searchStock(
  q: string,
): Promise<{ warehouseId: string; items: MedicationItem[] }> {
  const { data } = await api.get<{ warehouseId: string; items: MedicationItem[] }>(
    "/medical-clinic/stock-search",
    { params: { q } },
  );
  return data;
}

// ── Lo más vendido del consultorio ────────────────────────────────────
export interface ClinicTopItem {
  id: string;
  code: string;
  name: string;
  units: string;
  revenue: string;
}

export interface ClinicTop {
  medications: ClinicTopItem[];
  labStudies: ClinicTopItem[];
  diagnosticStudies: ClinicTopItem[];
}

export async function getClinicTop(period: DashboardPeriod): Promise<ClinicTop> {
  const { data } = await api.get<ClinicTop>("/medical-clinic/dashboard/top", {
    params: { period },
  });
  return data;
}

// ── Historias clínicas: el buscador y el resumen del paciente ─────────
/** Espejo de `RecordSummary` del API: una fila del listado. */
export interface RecordSummary {
  id: string;
  folio: string;
  status: "open" | "closed";
  editable: boolean;
  lockReason: RecordLockReason | null;
  consultationDate: string;
  patientName: string;
  doctorName: string;
  createdAt: string;
}

export interface RecordsPage {
  rows: RecordSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListRecordsParams {
  customerId?: string;
  query?: string;
  /** `YYYY-MM-DD`, fecha de consulta en el calendario del negocio. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listRecords(params: ListRecordsParams = {}): Promise<RecordsPage> {
  const { data } = await api.get<RecordsPage>("/medical-clinic/records", {
    params: Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== ""),
    ),
  });
  return data;
}

/** Espejo de `PatientSummary` del API (F9-CLINIC-32). */
export interface PatientSummary {
  customerId: string;
  name: string;
  birthDate: string | null;
  age: number | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** La sección Datos Generales de la última visita, si la hubo. */
  generalData: Record<string, unknown> | null;
  recordCount: number;
  lastRecord: PatientHit["lastRecord"];
}

export async function getPatient(customerId: string): Promise<PatientSummary> {
  const { data } = await api.get<PatientSummary>(`/medical-clinic/patients/${customerId}`);
  return data;
}
