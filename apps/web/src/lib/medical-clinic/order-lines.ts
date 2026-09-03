import type { MedicalOrderKind } from "@sellpoint/shared";
import type { CreateOrderLine, StudyKind } from "./api";

/**
 * F9-CLINIC-WEB-17/18 — la línea de una orden mientras se arma en pantalla.
 *
 * Dos formas: un estudio (precio del catálogo, cantidad fija 1) o un
 * medicamento (presentación de venta, cantidad e indicación por renglón).
 * `toPayload` es lo único que el API ve; lo demás es para pintar.
 */
export type OrderFormLine =
  | {
      key: string;
      kind: "study";
      studyKind: StudyKind;
      studyId: string;
      description: string;
      unitPrice: number;
    }
  | {
      key: string;
      kind: "medication";
      productId: string;
      presentationId: string;
      presentationName: string;
      description: string;
      unitPrice: number;
      /** Texto del input: se valida al emitir. */
      quantity: string;
      dosage: string;
      allowFractionalInput: boolean;
    };

export function lineQuantity(line: OrderFormLine): number {
  if (line.kind === "study") return 1;
  const n = Number(line.quantity);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function lineTotal(line: OrderFormLine): number {
  return lineQuantity(line) * line.unitPrice;
}

export function orderTotal(lines: readonly OrderFormLine[]): number {
  return lines.reduce((acc, line) => acc + lineTotal(line), 0);
}

/** Una cantidad tecleada, normalizada: sin decimales cuando la unidad no los admite. */
export function normalizeQuantity(raw: string, allowFractionalInput: boolean): string {
  if (raw === "") return "";
  if (allowFractionalInput) return raw;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

export function toPayload(line: OrderFormLine): CreateOrderLine {
  if (line.kind === "study") {
    return line.studyKind === "lab"
      ? { labStudyId: line.studyId }
      : { diagnosticStudyId: line.studyId };
  }
  const dosage = line.dosage.trim();
  return {
    productId: line.productId,
    presentationId: line.presentationId,
    quantity: lineQuantity(line),
    ...(dosage ? { dosage } : {}),
  };
}

export const STUDY_KIND_OF: Partial<Record<MedicalOrderKind, StudyKind>> = {
  lab_order: "lab",
  diagnostic_order: "diagnostic",
};
