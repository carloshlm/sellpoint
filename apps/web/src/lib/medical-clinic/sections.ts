import {
  MEDICAL_RECORD_SECTIONS,
  type MedicalOrderKind,
  type MedicalRecordSectionGroup,
  type MedicalRecordSectionKey,
} from "@sellpoint/shared";
import {
  Activity,
  ArrowRightLeft,
  Baby,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  Leaf,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Map as MapIcon,
  MessageSquareText,
  Microscope,
  NotebookPen,
  Pill,
  Receipt,
  Ruler,
  Stethoscope,
  Syringe,
  Thermometer,
  TriangleAlert,
  Users,
  UsersRound,
} from "lucide-react";
import type { MedicalRecord } from "./api";

/**
 * F9-CLINIC-WEB-09 — el catálogo de tarjetas del tablero.
 *
 * Las 22 secciones vienen de shared (la misma lista que valida el API); las
 * cuatro tarjetas de «Órdenes médicas» son de ESTA pantalla: tres emiten una
 * orden y una lista las emitidas. El grupo `orders` no existe en shared a
 * propósito — una orden no es una sección del expediente, es un documento
 * con folio propio.
 */
export type RecordGroup = MedicalRecordSectionGroup | "orders";
export const RECORD_GROUPS: readonly RecordGroup[] = [
  "interrogation",
  "examination",
  "assessment_plan",
  "orders",
  "documents",
];

export type OrderCardKey = MedicalOrderKind | "orders_list";
export type RecordCardKey = MedicalRecordSectionKey | OrderCardKey;

export interface RecordCard {
  key: RecordCardKey;
  group: RecordGroup;
  icon: LucideIcon;
  kind: "section" | "order" | "orders_list";
  /** Tiene formulario (o ruta) hoy. Las demás se pintan inertes con «Próximamente». */
  functional: boolean;
}

const SECTION_ICONS = {
  general_data: ClipboardList,
  chief_complaint: MessageSquareText,
  current_illness: Activity,
  family_history: Users,
  pathological_history: HeartPulse,
  non_pathological_history: Leaf,
  gyneco_obstetric_history: Baby,
  allergies: TriangleAlert,
  current_medications: Pill,
  systems_review: ListChecks,
  vital_signs: Thermometer,
  anthropometry: Ruler,
  physical_exam: Stethoscope,
  study_results: FileText,
  diagnostic_impression: Lightbulb,
  diagnoses: ClipboardCheck,
  treatment: Syringe,
  management_plan: MapIcon,
  follow_up: CalendarClock,
  medical_notes: NotebookPen,
  referrals: ArrowRightLeft,
  interconsultations: UsersRound,
} satisfies Record<MedicalRecordSectionKey, LucideIcon>;

const ORDER_CARDS: readonly RecordCard[] = [
  { key: "prescription", group: "orders", icon: Pill, kind: "order", functional: true },
  { key: "lab_order", group: "orders", icon: FlaskConical, kind: "order", functional: true },
  { key: "diagnostic_order", group: "orders", icon: Microscope, kind: "order", functional: true },
  { key: "orders_list", group: "orders", icon: Receipt, kind: "orders_list", functional: true },
];

export const RECORD_CARDS: readonly RecordCard[] = [
  ...MEDICAL_RECORD_SECTIONS.map(
    (section): RecordCard => ({
      key: section.key,
      group: section.group,
      icon: (SECTION_ICONS as Record<string, LucideIcon>)[section.key] ?? ClipboardList,
      kind: "section",
      functional: section.functional,
    }),
  ),
  ...ORDER_CARDS,
];

/** Las secciones con formulario: son las que cuentan para el progreso. */
export const FUNCTIONAL_SECTION_KEYS: readonly MedicalRecordSectionKey[] =
  MEDICAL_RECORD_SECTIONS.filter((s) => s.functional).map((s) => s.key);

/**
 * F9-CLINIC-HC-13 — el sexo decide qué se PIDE, el dato decide qué se
 * MUESTRA. Una sección con `sexes` (AGO) no se dibuja para los demás sexos…
 * salvo que ya tenga datos: esconder jamás es borrar. Sin sexo capturado se
 * pide a todos.
 */
export function isSectionVisible(record: MedicalRecord, key: string): boolean {
  const def = MEDICAL_RECORD_SECTIONS.find((s) => s.key === key);
  if (def === undefined || def.sexes === undefined) return true;
  const sex = record.patient.sex;
  if (sex === null || (def.sexes as readonly string[]).includes(sex)) return true;
  return sectionStatus(record, key) === "completed";
}

/** Las tarjetas que se dibujan para ESTE expediente; las de órdenes siempre. */
export function visibleCards(record: MedicalRecord): RecordCard[] {
  return RECORD_CARDS.filter(
    (card) => card.kind !== "section" || isSectionVisible(record, card.key),
  );
}

/** Las funcionales visibles: el denominador del progreso de cada grupo. */
export function visibleFunctionalKeys(record: MedicalRecord): MedicalRecordSectionKey[] {
  return FUNCTIONAL_SECTION_KEYS.filter((key) => isSectionVisible(record, key));
}

/**
 * F9-CLINIC-DOC-01 — la barra del encabezado mide la HISTORIA CLÍNICA: los
 * tres bloques clínicos. Documentos (notas, referencias, interconsultas) no
 * cuenta: una consulta sin referencias está completa, y una barra que nunca
 * llega a 100 % enseña a ignorarla. Por eso «N de 19» es una decisión con
 * nombre y no un número que sobrevivió por suerte.
 */
export const PROGRESS_GROUPS: readonly RecordGroup[] = [
  "interrogation",
  "examination",
  "assessment_plan",
];

/** Las funcionales visibles de los bloques clínicos: el denominador de la barra. */
export function progressKeys(record: MedicalRecord): MedicalRecordSectionKey[] {
  return visibleFunctionalKeys(record).filter((key) =>
    PROGRESS_GROUPS.includes(
      MEDICAL_RECORD_SECTIONS.find((s) => s.key === key)?.group ?? "documents",
    ),
  );
}

/** Cuántos documentos tiene la consulta: la suma de los ítems del grupo. */
export function documentsCount(record: MedicalRecord): number {
  return MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "documents").reduce((total, def) => {
    const data = record.sections.find((s) => s.key === def.key)?.data;
    const items =
      data && typeof data === "object" ? (data as Record<string, unknown>).items : undefined;
    return total + (Array.isArray(items) ? items.length : 0);
  }, 0);
}

export type SectionStatus = "pending" | "completed";
export type GroupStatus = SectionStatus | "inProgress";

/**
 * Una sección está capturada cuando tiene fila con datos. Una fila con `{}`
 * (guardada vacía) cuenta como pendiente aunque el server la reporte
 * completada; sin datos legibles, manda el estado del server.
 */
export function sectionStatus(record: MedicalRecord, key: string): SectionStatus {
  const section = record.sections.find((s) => s.key === key);
  if (!section) return "pending";
  const data = section.data;
  if (data && typeof data === "object") {
    return Object.keys(data).length > 0 ? "completed" : "pending";
  }
  return section.status === "completed" ? "completed" : "pending";
}

export function groupProgress(
  record: MedicalRecord,
  group: RecordGroup,
): { done: number; total: number } {
  const keys = visibleFunctionalKeys(record).filter(
    (key) => MEDICAL_RECORD_SECTIONS.find((s) => s.key === key)?.group === group,
  );
  const done = keys.filter((key) => sectionStatus(record, key) === "completed").length;
  return { done, total: keys.length };
}

/** «En progreso» vive en el grupo: alguna funcional capturada, no todas. */
export function groupStatus(record: MedicalRecord, group: RecordGroup): GroupStatus {
  const { done, total } = groupProgress(record, group);
  if (total === 0 || done === 0) return "pending";
  return done === total ? "completed" : "inProgress";
}
