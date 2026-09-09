import type { ComponentType } from "react";
import type { MedicalRecord } from "@/lib/medical-clinic/api";
import { AllergiesForm } from "./allergies-form";
import { AnthropometryForm } from "./anthropometry-form";
import { ChiefComplaintForm } from "./chief-complaint-form";
import { CurrentIllnessForm } from "./current-illness-form";
import { CurrentMedicationsForm } from "./current-medications-form";
import { DiagnosesForm } from "./diagnoses-form";
import { DiagnosticImpressionForm } from "./diagnostic-impression-form";
import { FamilyHistoryForm } from "./family-history-form";
import { FollowUpForm } from "./follow-up-form";
import { GeneralDataForm } from "./general-data-form";
import { GynecoObstetricForm } from "./gyneco-obstetric-form";
import { InterconsultationsForm } from "./interconsultations-form";
import { ManagementPlanForm } from "./management-plan-form";
import { MedicalNotesForm } from "./medical-notes-form";
import { NonPathologicalHistoryForm } from "./non-pathological-history-form";
import { PathologicalHistoryForm } from "./pathological-history-form";
import { PhysicalExamForm } from "./physical-exam-form";
import { ReferralsForm } from "./referrals-form";
import { StudyResultsForm } from "./study-results-form";
import { SystemsReviewForm } from "./systems-review-form";
import { TreatmentForm } from "./treatment-form";
import { VitalSignsForm } from "./vital-signs-form";

/**
 * F9-CLINIC-WEB-13 — el contrato de un formulario de sección.
 *
 * El formulario captura y valida; la RUTA guarda y navega. Así cada
 * formulario se prueba solo y el registro crece con una línea por sección.
 */
export interface SectionFormProps {
  recordId: string;
  initialData: Record<string, unknown>;
  /** Años cumplidos el día de la consulta (F9-CLINIC-HC-14): decide categoría OMS y semáforo. */
  patientAge: number | null;
  /** `YYYY-MM-DD` de la consulta (F9-CLINIC-HC-21): la próxima cita no es anterior. */
  consultationDate: string;
  /** Las órdenes emitidas del expediente (F9-CLINIC-HC-19): Tratamiento enlista las recetas. */
  orders: MedicalRecord["orders"];
  /** Las secciones del expediente (F9-CLINIC-DOC-03): las cartas traen de ellas el resumen clínico. */
  sections: MedicalRecord["sections"];
  readOnly: boolean;
  busy: boolean;
  /** Error del API, ya traducido. */
  error: string | null;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}

export const SECTION_FORMS: Partial<Record<string, ComponentType<SectionFormProps>>> = {
  general_data: GeneralDataForm,
  chief_complaint: ChiefComplaintForm,
  current_illness: CurrentIllnessForm,
  family_history: FamilyHistoryForm,
  pathological_history: PathologicalHistoryForm,
  non_pathological_history: NonPathologicalHistoryForm,
  gyneco_obstetric_history: GynecoObstetricForm,
  allergies: AllergiesForm,
  current_medications: CurrentMedicationsForm,
  systems_review: SystemsReviewForm,
  anthropometry: AnthropometryForm,
  vital_signs: VitalSignsForm,
  physical_exam: PhysicalExamForm,
  study_results: StudyResultsForm,
  diagnostic_impression: DiagnosticImpressionForm,
  diagnoses: DiagnosesForm,
  treatment: TreatmentForm,
  management_plan: ManagementPlanForm,
  follow_up: FollowUpForm,
  medical_notes: MedicalNotesForm,
  referrals: ReferralsForm,
  interconsultations: InterconsultationsForm,
};
