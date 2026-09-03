import { z } from "zod";
import { isE164 } from "./phone";

/**
 * F9-CLINIC-01 — el catálogo de la historia clínica, en CÓDIGO compartido.
 *
 * Las 32 secciones del expediente viven en UNA tabla
 * (`medical_clinic_record_sections`, una fila por clave con `data` JSONB).
 * Lo que fija la forma de cada JSON no es la base: es este catálogo y sus
 * schemas zod, que el API usa al escribir y el web al pintar. Una sección sin
 * schema no es funcional (el API responde 422 al intentar guardarla); agregar
 * una sección funcional es agregar su schema y marcarla, cero DDL.
 *
 * El orden es el de Carlos (2026-09-03), tarjeta por tarjeta.
 */
export const MEDICAL_RECORD_SECTION_GROUPS = [
  "interrogation",
  "examination",
  "assessment_plan",
  "documents",
] as const;
export type MedicalRecordSectionGroup = (typeof MEDICAL_RECORD_SECTION_GROUPS)[number];

export interface MedicalRecordSectionDef {
  key: string;
  group: MedicalRecordSectionGroup;
  /** Posición dentro de su grupo, 1-based. */
  order: number;
  /** Con formulario y schema hoy. Las demás son tarjetas «Próximamente». */
  functional: boolean;
}

const seccion = (
  key: string,
  group: MedicalRecordSectionGroup,
  order: number,
  functional = false,
) => ({ key, group, order, functional }) as const;

export const MEDICAL_RECORD_SECTIONS = [
  // 1. Interrogatorio
  seccion("general_data", "interrogation", 1, true),
  seccion("chief_complaint", "interrogation", 2, true),
  seccion("current_illness", "interrogation", 3, true),
  seccion("family_history", "interrogation", 4),
  seccion("pathological_history", "interrogation", 5),
  seccion("non_pathological_history", "interrogation", 6),
  seccion("gyneco_obstetric_history", "interrogation", 7),
  seccion("allergies", "interrogation", 8),
  seccion("current_medications", "interrogation", 9),
  seccion("systems_review", "interrogation", 10),
  // 2. Exploración
  seccion("vital_signs", "examination", 1),
  seccion("anthropometry", "examination", 2),
  seccion("physical_exam", "examination", 3),
  seccion("systems_exam", "examination", 4),
  seccion("lab_studies", "examination", 5),
  seccion("imaging_studies", "examination", 6),
  seccion("study_results", "examination", 7),
  // 3. Evaluación y plan
  seccion("diagnostic_impression", "assessment_plan", 1),
  seccion("primary_diagnosis", "assessment_plan", 2),
  seccion("secondary_diagnoses", "assessment_plan", 3),
  seccion("differential_diagnosis", "assessment_plan", 4),
  seccion("treatment", "assessment_plan", 5),
  seccion("management_plan", "assessment_plan", 6),
  seccion("recommendations", "assessment_plan", 7),
  seccion("follow_up", "assessment_plan", 8),
  // 5. Documentos y seguimiento (el 4, Órdenes médicas, no son secciones:
  // son tres órdenes y un listado, y viven en `medical_clinic_orders`)
  seccion("prescriptions_doc", "documents", 1),
  seccion("studies_doc", "documents", 2),
  seccion("attachments", "documents", 3),
  seccion("medical_notes", "documents", 4),
  seccion("referrals", "documents", 5),
  seccion("interconsultations", "documents", 6),
  seccion("follow_up_appointments", "documents", 7),
] as const satisfies readonly MedicalRecordSectionDef[];

export type MedicalRecordSectionKey = (typeof MEDICAL_RECORD_SECTIONS)[number]["key"];
export const MEDICAL_RECORD_SECTION_KEYS = MEDICAL_RECORD_SECTIONS.map(
  (s) => s.key,
) as readonly MedicalRecordSectionKey[] as [MedicalRecordSectionKey, ...MedicalRecordSectionKey[]];
export const medicalRecordSectionKeySchema = z.enum(MEDICAL_RECORD_SECTION_KEYS);

// ─────────────────────────────────────────────────────────────────────────
// Los schemas de las secciones funcionales
// ─────────────────────────────────────────────────────────────────────────

/** F, M, X: lo que la cabecera del expediente muestra. */
export const MEDICAL_SEXES = ["F", "M", "X"] as const;
export type MedicalSex = (typeof MEDICAL_SEXES)[number];

export const MARITAL_STATUSES = [
  "single",
  "married",
  "free_union",
  "divorced",
  "widowed",
  "other",
] as const;
export const EDUCATION_LEVELS = [
  "none",
  "primary",
  "secondary",
  "high_school",
  "university",
  "postgraduate",
] as const;
export const ONSET_UNITS = ["hours", "days", "weeks", "months", "years"] as const;

const texto = (max: number) => z.string().trim().max(max);
const HOY_ISO = () => new Date().toISOString().slice(0, 10);
const fechaNoFutura = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((valor) => !Number.isNaN(Date.parse(valor)) && valor <= HOY_ISO());

/**
 * Datos Generales: todo opcional (guardar a medias es Completado, regla de
 * Carlos), `.strict()` para que el JSON no crezca con claves inventadas. El
 * sexo se proyecta al encabezado del expediente al guardar.
 */
export const generalDataSchema = z
  .object({
    sex: z.enum(MEDICAL_SEXES).optional(),
    maritalStatus: z.enum(MARITAL_STATUSES).optional(),
    occupation: texto(120).optional(),
    education: z.enum(EDUCATION_LEVELS).optional(),
    address: texto(300).optional(),
    emergencyContactName: texto(120).optional(),
    emergencyContactPhone: z.string().trim().refine(isE164).optional(),
  })
  .strict();

export const chiefComplaintSchema = z
  .object({
    complaint: texto(2000).optional(),
    onsetValue: z.number().int().nonnegative().optional(),
    onsetUnit: z.enum(ONSET_UNITS).optional(),
  })
  .strict();

export const currentIllnessSchema = z
  .object({
    startDate: fechaNoFutura.optional(),
    narrative: texto(5000).optional(),
  })
  .strict();

export type GeneralData = z.infer<typeof generalDataSchema>;
export type ChiefComplaint = z.infer<typeof chiefComplaintSchema>;
export type CurrentIllness = z.infer<typeof currentIllnessSchema>;

/** Solo las funcionales tienen schema; el test del catálogo lo exige. */
export const MEDICAL_RECORD_SECTION_SCHEMAS: Partial<
  Record<MedicalRecordSectionKey, z.ZodType<Record<string, unknown>>>
> = {
  general_data: generalDataSchema,
  chief_complaint: chiefComplaintSchema,
  current_illness: currentIllnessSchema,
};

// ─────────────────────────────────────────────────────────────────────────
// Las órdenes médicas
// ─────────────────────────────────────────────────────────────────────────

export const MEDICAL_ORDER_KINDS = ["prescription", "lab_order", "diagnostic_order"] as const;
export type MedicalOrderKind = (typeof MEDICAL_ORDER_KINDS)[number];
export const medicalOrderKindSchema = z.enum(MEDICAL_ORDER_KINDS);
