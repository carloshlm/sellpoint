import type { ComponentType } from "react";
import { ChiefComplaintForm } from "./chief-complaint-form";
import { CurrentIllnessForm } from "./current-illness-form";
import { FamilyHistoryForm } from "./family-history-form";
import { GeneralDataForm } from "./general-data-form";
import { GynecoObstetricForm } from "./gyneco-obstetric-form";
import { NonPathologicalHistoryForm } from "./non-pathological-history-form";
import { PathologicalHistoryForm } from "./pathological-history-form";

/**
 * F9-CLINIC-WEB-13 — el contrato de un formulario de sección.
 *
 * El formulario captura y valida; la RUTA guarda y navega. Así cada
 * formulario se prueba solo y el registro crece con una línea por sección.
 */
export interface SectionFormProps {
  recordId: string;
  initialData: Record<string, unknown>;
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
};
