import type { ComponentType } from "react";
import { AllergiesForm } from "./allergies-form";
import { AnthropometryForm } from "./anthropometry-form";
import { ChiefComplaintForm } from "./chief-complaint-form";
import { CurrentIllnessForm } from "./current-illness-form";
import { CurrentMedicationsForm } from "./current-medications-form";
import { FamilyHistoryForm } from "./family-history-form";
import { GeneralDataForm } from "./general-data-form";
import { GynecoObstetricForm } from "./gyneco-obstetric-form";
import { NonPathologicalHistoryForm } from "./non-pathological-history-form";
import { PathologicalHistoryForm } from "./pathological-history-form";
import { PhysicalExamForm } from "./physical-exam-form";
import { StudyResultsForm } from "./study-results-form";
import { SystemsReviewForm } from "./systems-review-form";
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
};
