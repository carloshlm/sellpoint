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
  CalendarPlus,
  ClipboardList,
  FileText,
  FlaskConical,
  FolderOpen,
  GitBranch,
  HeartPulse,
  Leaf,
  Lightbulb,
  ListChecks,
  ListPlus,
  type LucideIcon,
  Map as MapIcon,
  MessageCircle,
  MessageSquareText,
  Microscope,
  NotebookPen,
  Paperclip,
  Pill,
  Receipt,
  Ruler,
  ScanLine,
  ScanSearch,
  ScrollText,
  Stethoscope,
  Syringe,
  Target,
  Thermometer,
  TriangleAlert,
  Users,
  UsersRound,
} from "lucide-react";
import type { MedicalRecord } from "./api";

/**
 * F9-CLINIC-WEB-09 — el catálogo de tarjetas del tablero.
 *
 * Las 32 secciones vienen de shared (la misma lista que valida el API); las
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
  systems_exam: ScanSearch,
  lab_studies: FlaskConical,
  imaging_studies: ScanLine,
  study_results: FileText,
  diagnostic_impression: Lightbulb,
  primary_diagnosis: Target,
  secondary_diagnoses: ListPlus,
  differential_diagnosis: GitBranch,
  treatment: Syringe,
  management_plan: MapIcon,
  recommendations: MessageCircle,
  follow_up: CalendarClock,
  prescriptions_doc: ScrollText,
  studies_doc: FolderOpen,
  attachments: Paperclip,
  medical_notes: NotebookPen,
  referrals: ArrowRightLeft,
  interconsultations: UsersRound,
  follow_up_appointments: CalendarPlus,
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
  const keys = FUNCTIONAL_SECTION_KEYS.filter(
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
