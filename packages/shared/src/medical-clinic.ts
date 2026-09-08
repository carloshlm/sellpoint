import { z } from "zod";
import { isE164 } from "./phone";

/**
 * F9-CLINIC-01 / F9-CLINIC-HC-01 — el catálogo de la historia clínica, en
 * CÓDIGO compartido.
 *
 * Las 26 secciones del expediente viven en UNA tabla
 * (`medical_clinic_record_sections`, una fila por clave con `data` JSONB).
 * Lo que fija la forma de cada JSON no es la base: es este catálogo y sus
 * schemas zod, que el API usa al escribir y el web al pintar. Una sección sin
 * schema no es funcional (el API responde 422 al intentar guardarla); agregar
 * una sección funcional es agregar su schema y marcarla, cero DDL.
 *
 * Eran 32 (Carlos, 2026-09-03). El 2026-09-08 Carlos decidió fusionar a 26
 * para que el médico haga menos viajes de ida y vuelta: «Exploración por
 * aparatos y sistemas» se fundió con Exploración Física (es lo mismo por
 * regiones, NOM-004 6.1.2); «Estudios de laboratorio» y «de gabinete» se
 * fundieron en Resultados de Estudios (PEDIRLOS ya vive en Órdenes médicas;
 * lo que la NOM pide aquí, 6.1.3, son resultados); los tres diagnósticos
 * (principal, secundarios, diferencial) son UNA lista en `diagnoses`;
 * Pronóstico (NOM 6.1.5) entra en Plan de Manejo; Recomendaciones en
 * Seguimiento. Somatometría va PRIMERO en Exploración: es lo que la asistente
 * ya midió. Retirar claves fue cero DDL: `section_key` no tiene CHECK y las
 * siete nunca tuvieron schema, así que no había ni una fila.
 */
export const MEDICAL_RECORD_SECTION_GROUPS = [
  "interrogation",
  "examination",
  "assessment_plan",
  "documents",
] as const;
export type MedicalRecordSectionGroup = (typeof MEDICAL_RECORD_SECTION_GROUPS)[number];

/** F, M, X: lo que la cabecera del expediente muestra. */
export const MEDICAL_SEXES = ["F", "M", "X"] as const;
export type MedicalSex = (typeof MEDICAL_SEXES)[number];

export interface MedicalRecordSectionDef {
  key: string;
  group: MedicalRecordSectionGroup;
  /** Posición dentro de su grupo, 1-based. */
  order: number;
  /** Con formulario y schema hoy. Las demás son tarjetas «Próximamente». */
  functional: boolean;
  /**
   * F9-CLINIC-HC-01 — es del PACIENTE, no de la consulta: al abrir un
   * expediente nuevo se copia del anterior del mismo paciente (con
   * `source_record_id`), y el médico confirma o actualiza. Signos vitales,
   * exploración y diagnósticos no se heredan: son del día.
   */
  carriedForward: boolean;
  /**
   * Se PIDE solo a estos sexos (la tarjeta no se dibuja para los demás), pero
   * si ya tiene datos se MUESTRA siempre: esconder jamás es borrar.
   * `undefined` = se pide a todos.
   */
  sexes?: readonly MedicalSex[];
}

const seccion = (
  key: string,
  group: MedicalRecordSectionGroup,
  order: number,
  opciones: { functional?: boolean; carriedForward?: boolean; sexes?: readonly MedicalSex[] } = {},
) =>
  ({
    key,
    group,
    order,
    functional: opciones.functional ?? false,
    carriedForward: opciones.carriedForward ?? false,
    ...(opciones.sexes !== undefined && { sexes: opciones.sexes }),
  }) as const;

const heredada = { carriedForward: true } as const;

export const MEDICAL_RECORD_SECTIONS = [
  // 1. Interrogatorio
  seccion("general_data", "interrogation", 1, { functional: true, carriedForward: true }),
  seccion("chief_complaint", "interrogation", 2, { functional: true }),
  seccion("current_illness", "interrogation", 3, { functional: true }),
  seccion("family_history", "interrogation", 4, heredada),
  seccion("pathological_history", "interrogation", 5, heredada),
  seccion("non_pathological_history", "interrogation", 6, heredada),
  seccion("gyneco_obstetric_history", "interrogation", 7, { ...heredada, sexes: ["F", "X"] }),
  seccion("allergies", "interrogation", 8, heredada),
  seccion("current_medications", "interrogation", 9, heredada),
  seccion("systems_review", "interrogation", 10),
  // 2. Exploración (Somatometría primero: ya la midió la asistente)
  seccion("anthropometry", "examination", 1),
  seccion("vital_signs", "examination", 2),
  seccion("physical_exam", "examination", 3),
  seccion("study_results", "examination", 4),
  // 3. Evaluación y plan
  seccion("diagnostic_impression", "assessment_plan", 1),
  seccion("diagnoses", "assessment_plan", 2),
  seccion("treatment", "assessment_plan", 3),
  seccion("management_plan", "assessment_plan", 4),
  seccion("follow_up", "assessment_plan", 5),
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

/** Las que se copian del expediente anterior del mismo paciente al abrir uno nuevo. */
export const CARRIED_FORWARD_SECTION_KEYS = MEDICAL_RECORD_SECTIONS.filter(
  (s) => s.carriedForward,
).map((s) => s.key) as readonly MedicalRecordSectionKey[];

// ─────────────────────────────────────────────────────────────────────────
// Los schemas de las secciones funcionales
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// El candado del expediente (F9-CLINIC-25)
// ─────────────────────────────────────────────────────────────────────────

export const MEDICAL_RECORD_STATUSES = ["open", "closed"] as const;
export type MedicalRecordStatus = (typeof MEDICAL_RECORD_STATUSES)[number];

/** Por qué una historia clínica ya no acepta captura. `null` = se puede capturar. */
export type MedicalRecordLockReason = "closed" | "expired";

/**
 * ¿Se puede seguir capturando esta consulta?
 *
 * Dos motivos la cierran: el médico la CERRÓ, o ya pasó su día. Lo segundo
 * es lo que Carlos pidió (2026-09-03): una consulta es de un día; si el
 * expediente quedó abierto y amaneció, se lee pero no se captura, y el
 * paciente que vuelve estrena folio.
 *
 * El vencimiento se DERIVA, no se persiste: marcar `closed` exigiría un
 * `closed_by` (lo obliga el CHECK `closed_by_coherent`) y no hay ningún
 * humano detrás de un cambio de día. Así tampoco hace falta un proceso
 * nocturno: la verdad se calcula al leer.
 *
 * `today` lo pone quien llama —`localCalendarDate(tenant.timezone, now)`—
 * porque el día que importa es el del NEGOCIO, no el del servidor ni el del
 * navegador. Ambas fechas son `YYYY-MM-DD`, así que se comparan como texto:
 * el orden lexicográfico del ISO es el cronológico, y así no hay `Date` de
 * por medio que reinterprete una zona horaria a media noche.
 *
 * Una fecha FUTURA no vence (un reloj mal puesto no le quita el trabajo al
 * médico), y `closed` gana sobre `expired`: al que cerró la consulta hay que
 * decirle que está cerrada, no que se le hizo tarde.
 *
 * Ojo: si el negocio cambia su zona horaria, una consulta al filo de la
 * medianoche puede pasar de vigente a vencida (o al revés). Es el precio de
 * derivar el estado y es preferible a un `closed_by` inventado.
 */
export function medicalRecordLock(
  record: { status: string; consultationDate: string },
  today: string,
): MedicalRecordLockReason | null {
  if (record.status === "closed") {
    return "closed";
  }
  return record.consultationDate < today ? "expired" : null;
}
