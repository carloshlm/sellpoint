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
  seccion("family_history", "interrogation", 4, { ...heredada, functional: true }),
  seccion("pathological_history", "interrogation", 5, { ...heredada, functional: true }),
  seccion("non_pathological_history", "interrogation", 6, { ...heredada, functional: true }),
  seccion("gyneco_obstetric_history", "interrogation", 7, {
    ...heredada,
    functional: true,
    sexes: ["F", "X"],
  }),
  seccion("allergies", "interrogation", 8, { ...heredada, functional: true }),
  seccion("current_medications", "interrogation", 9, { ...heredada, functional: true }),
  seccion("systems_review", "interrogation", 10, { functional: true }),
  // 2. Exploración (Somatometría primero: ya la midió la asistente)
  seccion("anthropometry", "examination", 1, { functional: true }),
  seccion("vital_signs", "examination", 2, { functional: true }),
  seccion("physical_exam", "examination", 3, { functional: true }),
  seccion("study_results", "examination", 4, { functional: true }),
  // 3. Evaluación y plan
  seccion("diagnostic_impression", "assessment_plan", 1, { functional: true }),
  seccion("diagnoses", "assessment_plan", 2, { functional: true }),
  seccion("treatment", "assessment_plan", 3, { functional: true }),
  seccion("management_plan", "assessment_plan", 4, { functional: true }),
  seccion("follow_up", "assessment_plan", 5, { functional: true }),
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
    /** NOM-004 6.1.1 pide el grupo étnico en la ficha de identificación (F9-CLINIC-HC-13). */
    ethnicGroup: texto(80).optional(),
    religion: texto(80).optional(),
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

// ─────────────────────────────────────────────────────────────────────────
// F9-CLINIC-HC — el interrogatorio (Bloque 1)
//
// Leyes comunes: `.strict()` en todo objeto; lo NEGADO se guarda explícito
// (`{ negated: true }`: «AHF negados» no es «sin AHF»); un objeto vacío `{}`
// sigue siendo válido porque guardar sin datos BORRA la fila (regla de
// Carlos: Guardar a medias es Completado, guardar nada es Pendiente); las
// filas de una lista exigen su dato principal y el formulario quita las
// vacías antes de mandar, porque el API solo limpia el primer nivel.
// ─────────────────────────────────────────────────────────────────────────

/** `{ negated: true }` solo, sin nada más: la marca es toda la sección. */
const negado = z.object({ negated: z.literal(true) }).strict();
const anioMax = () => new Date().getUTCFullYear();
const anio = z
  .number()
  .int()
  .min(1900)
  .refine((v) => v <= anioMax(), { message: "medical_clinic.year_in_future" });
const entero = (min: number, max: number) => z.number().int().min(min).max(max);

// ── Antecedentes heredofamiliares (HC-06) ────────────────────────────────
export const FAMILY_CONDITIONS = [
  "diabetes",
  "hypertension",
  "heart_disease",
  "kidney_disease",
  "thyroid",
  "asthma_copd",
  "epilepsy",
  "mental_illness",
  "congenital",
  "tuberculosis",
  "rheumatic",
  "cancer",
  "obesity",
  "dyslipidemia",
  "allergies",
  "other",
] as const;
export const RELATIVES = [
  "father",
  "mother",
  "siblings",
  "paternal_grandparents",
  "maternal_grandparents",
  "children",
  "other",
] as const;

const antecedenteFamiliar = z
  .object({
    condition: z.enum(FAMILY_CONDITIONS),
    relatives: z.array(z.enum(RELATIVES)).min(1),
    otherLabel: texto(80).optional(),
    notes: texto(200).optional(),
  })
  .strict()
  .refine((c) => c.condition !== "other" || (c.otherLabel ?? "") !== "", {
    message: "medical_clinic.other_label_required",
    path: ["otherLabel"],
  });

export const familyHistorySchema = z.union([
  negado,
  z
    .object({
      conditions: z.array(antecedenteFamiliar).min(1).optional(),
      notes: texto(1000).optional(),
    })
    .strict(),
]);

// ── Antecedentes personales patológicos (HC-07) ──────────────────────────
export const CHILDHOOD_DISEASES = [
  "measles",
  "chickenpox",
  "rubella",
  "mumps",
  "scarlet_fever",
  "whooping_cough",
] as const;
export const CHRONIC_CONDITIONS = [
  "diabetes",
  "hypertension",
  "asthma",
  "copd",
  "heart_disease",
  "kidney_disease",
  "thyroid",
  "epilepsy",
  "cancer",
  "arthritis",
  "depression_anxiety",
  "other",
] as const;
export const INFECTIOUS_DISEASES = [
  "covid19",
  "hepatitis",
  "tuberculosis",
  "sti",
  "dengue",
  "other",
] as const;

export const pathologicalHistorySchema = z.union([
  negado,
  z
    .object({
      childhood: z.array(z.enum(CHILDHOOD_DISEASES)).min(1).optional(),
      chronic: z
        .array(
          z
            .object({
              condition: z.enum(CHRONIC_CONDITIONS),
              otherLabel: texto(80).optional(),
              sinceYear: anio.optional(),
              treatment: texto(200).optional(),
            })
            .strict()
            .refine((c) => c.condition !== "other" || (c.otherLabel ?? "") !== "", {
              message: "medical_clinic.other_label_required",
              path: ["otherLabel"],
            }),
        )
        .min(1)
        .optional(),
      surgeries: z
        .array(
          z
            .object({
              procedure: texto(120).min(1),
              year: anio.optional(),
              notes: texto(200).optional(),
            })
            .strict(),
        )
        .min(1)
        .optional(),
      traumas: z
        .array(z.object({ description: texto(200).min(1), year: anio.optional() }).strict())
        .min(1)
        .optional(),
      transfusions: z
        .object({ had: z.boolean(), year: anio.optional(), reaction: texto(200).optional() })
        .strict()
        .refine((t) => t.had || (t.year === undefined && t.reaction === undefined), {
          message: "medical_clinic.transfusion_details_without_transfusion",
        })
        .optional(),
      hospitalizations: z
        .array(z.object({ reason: texto(200).min(1), year: anio.optional() }).strict())
        .min(1)
        .optional(),
      infectious: z.array(z.enum(INFECTIOUS_DISEASES)).min(1).optional(),
      infectiousNotes: texto(500).optional(),
      notes: texto(1000).optional(),
    })
    .strict(),
]);

// ── Antecedentes personales no patológicos (HC-08) ───────────────────────
export const HOUSING_TYPES = ["own", "rented", "family", "other"] as const;
export const HOUSING_MATERIALS = ["concrete", "mixed", "precarious"] as const;
export const HOUSING_SERVICES = ["water", "sewage", "electricity", "gas", "internet"] as const;
export const QUALITY_LEVELS = ["good", "regular", "poor"] as const;
export const ACTIVITY_LEVELS = ["none", "occasional", "regular"] as const;
export const IMMUNIZATION_STATUSES = ["complete", "incomplete", "unknown"] as const;
export const SMOKING_STATUSES = ["never", "current", "former"] as const;
export const ALCOHOL_STATUSES = ["never", "occasional", "weekly", "daily", "former"] as const;
export const DRUG_STATUSES = ["never", "current", "former"] as const;
export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] as const;

export const nonPathologicalHistorySchema = z
  .object({
    housing: z
      .object({
        type: z.enum(HOUSING_TYPES).optional(),
        materials: z.enum(HOUSING_MATERIALS).optional(),
        services: z.array(z.enum(HOUSING_SERVICES)).min(1).optional(),
        residents: entero(1, 50).optional(),
        rooms: entero(1, 30).optional(),
      })
      .strict()
      .optional(),
    zoonosis: z
      .object({ has: z.boolean(), animals: texto(120).optional() })
      .strict()
      .optional(),
    diet: z.enum(QUALITY_LEVELS).optional(),
    dietNotes: texto(300).optional(),
    hygiene: z.enum(QUALITY_LEVELS).optional(),
    physicalActivity: z.enum(ACTIVITY_LEVELS).optional(),
    physicalActivityNotes: texto(200).optional(),
    immunizations: z.enum(IMMUNIZATION_STATUSES).optional(),
    immunizationsNotes: texto(300).optional(),
    smoking: z
      .object({
        status: z.enum(SMOKING_STATUSES),
        cigarettesPerDay: entero(1, 200).optional(),
        years: entero(1, 100).optional(),
        quitYear: anio.optional(),
      })
      .strict()
      // Quien nunca fumó no tiene cigarros al día ni años ni año en que dejó.
      .refine(
        (s) =>
          s.status !== "never" ||
          (s.cigarettesPerDay === undefined && s.years === undefined && s.quitYear === undefined),
        { message: "medical_clinic.smoking_details_for_never" },
      )
      .optional(),
    alcohol: z
      .object({ status: z.enum(ALCOHOL_STATUSES), notes: texto(200).optional() })
      .strict()
      .optional(),
    drugs: z
      .object({ status: z.enum(DRUG_STATUSES), substances: texto(200).optional() })
      .strict()
      .optional(),
    bloodType: z.enum(BLOOD_TYPES).optional(),
    religion: texto(80).optional(),
    notes: texto(1000).optional(),
  })
  .strict();

// ── Antecedentes gineco-obstétricos (HC-09) ──────────────────────────────
export const CONTRACEPTION_METHODS = [
  "none",
  "condom",
  "pill",
  "iud",
  "implant",
  "injection",
  "tubal_ligation",
  "partner_vasectomy",
  "natural",
  "other",
] as const;
export const SCREENING_RESULTS = ["normal", "abnormal", "pending"] as const;

const tamizaje = z
  .object({ date: fechaNoFutura.optional(), result: z.enum(SCREENING_RESULTS).optional() })
  .strict();

export const gynecoObstetricHistorySchema = z
  .object({
    menarcheAge: entero(8, 20).optional(),
    cycleDays: entero(15, 90).optional(),
    periodDays: entero(1, 15).optional(),
    lastPeriodDate: fechaNoFutura.optional(),
    sexualDebutAge: entero(8, 60).optional(),
    partners: entero(0, 99).optional(),
    gestations: entero(0, 30).optional(),
    births: entero(0, 30).optional(),
    abortions: entero(0, 30).optional(),
    cesareans: entero(0, 30).optional(),
    contraception: z.enum(CONTRACEPTION_METHODS).optional(),
    papSmear: tamizaje.optional(),
    mammogram: tamizaje.optional(),
    menopauseAge: entero(30, 70).optional(),
    pregnant: z.boolean().optional(),
    breastfeeding: z.boolean().optional(),
    notes: texto(1000).optional(),
  })
  .strict();

// ── Alergias (HC-10) ─────────────────────────────────────────────────────
export const ALLERGY_KINDS = ["drug", "food", "environmental", "latex", "other"] as const;
export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe"] as const;

export const allergiesSchema = z.union([
  negado,
  z
    .object({
      items: z
        .array(
          z
            .object({
              kind: z.enum(ALLERGY_KINDS),
              substance: texto(120).min(1),
              reaction: texto(200).optional(),
              severity: z.enum(ALLERGY_SEVERITIES).optional(),
            })
            .strict(),
        )
        .min(1)
        .optional(),
    })
    .strict(),
]);

// ── Medicamentos actuales (HC-11) ────────────────────────────────────────
export const currentMedicationsSchema = z.union([
  z.object({ none: z.literal(true) }).strict(),
  z
    .object({
      items: z
        .array(
          z
            .object({
              name: texto(120).min(1),
              dose: texto(60).optional(),
              frequency: texto(60).optional(),
              reason: texto(120).optional(),
              since: texto(40).optional(),
            })
            .strict(),
        )
        .min(1)
        .optional(),
      notes: texto(500).optional(),
    })
    .strict(),
]);

// ── Interrogatorio por aparatos y sistemas (HC-12) ───────────────────────
export const REVIEW_SYSTEMS = [
  "general",
  "skin",
  "cardiovascular",
  "respiratory",
  "digestive",
  "genitourinary",
  "endocrine",
  "nervous",
  "musculoskeletal",
  "hematologic",
  "psychiatric",
] as const;

/** Un ítem del checklist: normal explícito, o hallazgos con texto. */
export const findingSchema = z.union([
  z.object({ normal: z.literal(true) }).strict(),
  z.object({ findings: texto(1000).min(1) }).strict(),
]);
export type Finding = z.infer<typeof findingSchema>;

const porClave = <K extends string>(claves: readonly K[]) =>
  z.object(Object.fromEntries(claves.map((k) => [k, findingSchema.optional()]))).strict();

export const systemsReviewSchema = z.union([
  negado,
  z
    .object({
      systems: porClave(REVIEW_SYSTEMS).optional(),
      notes: texto(1000).optional(),
    })
    .strict(),
]);

// ─────────────────────────────────────────────────────────────────────────
// F9-CLINIC-HC — la exploración (Bloque 2)
//
// Números, no strings: el formulario convierte con `parseMeasure` antes de
// mandar. Lo derivado (IMC, categoría OMS, semáforo) NO viaja: se calcula
// con `medical-measures.ts` al pintar.
// ─────────────────────────────────────────────────────────────────────────

/** Un decimal como máximo: `36.55` no es una temperatura que mida nadie. */
const conDecimales = (min: number, max: number, decimales: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Number.isInteger(v * 10 ** decimales), {
      message: "medical_clinic.too_many_decimals",
    });

// ── Somatometría (HC-14) ─────────────────────────────────────────────────
export const anthropometrySchema = z
  .object({
    weightKg: conDecimales(0.5, 500, 1).optional(),
    heightCm: conDecimales(20, 250, 1).optional(),
    headCircumferenceCm: conDecimales(20, 70, 1).optional(),
    waistCm: conDecimales(30, 250, 1).optional(),
    hipCm: conDecimales(30, 250, 1).optional(),
  })
  .strict();

// ── Signos vitales (HC-15) ───────────────────────────────────────────────
export const vitalSignsSchema = z
  .object({
    systolic: entero(40, 300).optional(),
    diastolic: entero(20, 200).optional(),
    heartRate: entero(20, 300).optional(),
    respiratoryRate: entero(5, 80).optional(),
    temperatureC: conDecimales(30, 45, 1).optional(),
    oxygenSaturation: entero(50, 100).optional(),
    capillaryGlucoseMgDl: entero(20, 800).optional(),
    painScale: entero(0, 10).optional(),
  })
  .strict()
  .refine(
    (v) => v.systolic === undefined || v.diastolic === undefined || v.diastolic < v.systolic,
    { message: "medical_clinic.diastolic_not_below_systolic", path: ["diastolic"] },
  );

// ── Exploración física (HC-16) ───────────────────────────────────────────
export const EXAM_REGIONS = [
  "head",
  "eyes",
  "ears_nose_throat",
  "neck",
  "chest_lungs",
  "cardiovascular",
  "abdomen",
  "genitourinary",
  "extremities",
  "spine",
  "neurological",
  "skin",
] as const;

export const physicalExamSchema = z
  .object({
    /** El habitus exterior se DESCRIBE, no es normal/anormal. */
    habitus: texto(1000).optional(),
    regions: porClave(EXAM_REGIONS).optional(),
    notes: texto(1000).optional(),
  })
  .strict();

// ── Resultados de estudios (HC-17) ───────────────────────────────────────
export const STUDY_RESULT_KINDS = ["lab", "imaging", "other"] as const;
export const STUDY_INTERPRETATIONS = ["normal", "abnormal", "pending"] as const;

export const studyResultsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            kind: z.enum(STUDY_RESULT_KINDS),
            name: texto(120).min(1),
            /** El estudio del catálogo, si el nombre salió de ahí. */
            studyId: z.string().uuid().optional(),
            date: fechaNoFutura.optional(),
            result: texto(2000).min(1),
            interpretation: z.enum(STUDY_INTERPRETATIONS).optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    notes: texto(1000).optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────
// F9-CLINIC-HC — evaluación y plan (Bloque 3)
// ─────────────────────────────────────────────────────────────────────────

// ── Impresión diagnóstica y diagnósticos (HC-18) ─────────────────────────
export const diagnosticImpressionSchema = z.object({ impression: texto(2000).optional() }).strict();

export const DIAGNOSIS_ROLES = ["primary", "secondary", "differential"] as const;
export const DIAGNOSIS_CERTAINTIES = ["presumptive", "confirmed"] as const;
/** CIE-10: letra, dos dígitos y hasta dos decimales (J06.9, E11, I10). */
export const ICD10_CODE = /^[A-Z]\d{2}(\.\d{1,2})?$/;

export const diagnosesSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            role: z.enum(DIAGNOSIS_ROLES),
            description: texto(300).min(1),
            icd10Code: z.string().regex(ICD10_CODE).optional(),
            certainty: z.enum(DIAGNOSIS_CERTAINTIES).optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict()
  // Un solo principal: dos «principales» no dicen cuál es el que manda.
  .refine((d) => (d.items ?? []).filter((i) => i.role === "primary").length <= 1, {
    message: "medical_clinic.one_primary_diagnosis",
    path: ["items"],
  });

// ── Tratamiento (HC-19) ──────────────────────────────────────────────────
export const treatmentSchema = z
  .object({
    pharmacological: texto(4000).optional(),
    nonPharmacological: texto(2000).optional(),
    procedures: texto(2000).optional(),
  })
  .strict();

// ── Plan de manejo y pronóstico (HC-20) ──────────────────────────────────
export const PROGNOSES = ["good", "reserved", "poor"] as const;
export const managementPlanSchema = z
  .object({
    prognosis: z.enum(PROGNOSES).optional(),
    prognosisNotes: texto(500).optional(),
    plan: texto(4000).optional(),
  })
  .strict();

// ── Seguimiento y recomendaciones (HC-21) ────────────────────────────────
/**
 * Lo que un schema de sección puede necesitar del expediente. Es la primera
 * clave cuyo schema depende de él: la próxima cita no puede ser anterior a
 * la consulta (y NO se compara contra «hoy»: una consulta vencida se lee,
 * no se captura, y ese candado ya vive en `medicalRecordLock`).
 */
export interface SectionSchemaContext {
  /** `YYYY-MM-DD` en el calendario del negocio. */
  consultationDate: string;
}

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const followUpSchema = (ctx: SectionSchemaContext) =>
  z
    .object({
      nextAppointmentDate: fechaIso
        .refine((v) => !Number.isNaN(Date.parse(v)) && v >= ctx.consultationDate, {
          message: "medical_clinic.appointment_before_consultation",
        })
        .optional(),
      nextAppointmentNotes: texto(300).optional(),
      alarmSigns: texto(1000).optional(),
      recommendations: texto(2000).optional(),
    })
    .strict();

export type DiagnosticImpression = z.infer<typeof diagnosticImpressionSchema>;
export type Diagnoses = z.infer<typeof diagnosesSchema>;
export type Treatment = z.infer<typeof treatmentSchema>;
export type ManagementPlan = z.infer<typeof managementPlanSchema>;
export type FollowUp = z.infer<ReturnType<typeof followUpSchema>>;

export type Anthropometry = z.infer<typeof anthropometrySchema>;
export type VitalSigns = z.infer<typeof vitalSignsSchema>;
export type PhysicalExam = z.infer<typeof physicalExamSchema>;
export type StudyResults = z.infer<typeof studyResultsSchema>;

export type FamilyHistory = z.infer<typeof familyHistorySchema>;
export type PathologicalHistory = z.infer<typeof pathologicalHistorySchema>;
export type NonPathologicalHistory = z.infer<typeof nonPathologicalHistorySchema>;
export type GynecoObstetricHistory = z.infer<typeof gynecoObstetricHistorySchema>;
export type Allergies = z.infer<typeof allergiesSchema>;
export type CurrentMedications = z.infer<typeof currentMedicationsSchema>;
export type SystemsReview = z.infer<typeof systemsReviewSchema>;

type SectionSchema = z.ZodType<Record<string, unknown>>;
type SectionSchemaOrFactory = SectionSchema | ((ctx: SectionSchemaContext) => SectionSchema);

/**
 * Solo las funcionales tienen schema; el test del catálogo lo exige. Una
 * entrada puede ser el schema o una FÁBRICA que lo arma con el contexto del
 * expediente (`follow_up`); `resolveSectionSchema` unifica las dos formas.
 */
export const MEDICAL_RECORD_SECTION_SCHEMAS: Partial<
  Record<MedicalRecordSectionKey, SectionSchemaOrFactory>
> = {
  general_data: generalDataSchema,
  chief_complaint: chiefComplaintSchema,
  current_illness: currentIllnessSchema,
  family_history: familyHistorySchema,
  pathological_history: pathologicalHistorySchema,
  non_pathological_history: nonPathologicalHistorySchema,
  gyneco_obstetric_history: gynecoObstetricHistorySchema,
  allergies: allergiesSchema,
  current_medications: currentMedicationsSchema,
  systems_review: systemsReviewSchema,
  anthropometry: anthropometrySchema,
  vital_signs: vitalSignsSchema,
  physical_exam: physicalExamSchema,
  study_results: studyResultsSchema,
  diagnostic_impression: diagnosticImpressionSchema,
  diagnoses: diagnosesSchema,
  treatment: treatmentSchema,
  management_plan: managementPlanSchema,
  follow_up: followUpSchema,
};

/** El schema listo para validar, o `undefined` si la sección no es funcional. */
export function resolveSectionSchema(
  key: MedicalRecordSectionKey,
  ctx: SectionSchemaContext,
): SectionSchema | undefined {
  const entrada = MEDICAL_RECORD_SECTION_SCHEMAS[key];
  if (entrada === undefined) return undefined;
  return typeof entrada === "function" ? entrada(ctx) : entrada;
}

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
