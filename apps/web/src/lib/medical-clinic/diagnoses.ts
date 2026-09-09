import type { MedicalRecord } from "./api";

/**
 * F9-CLINIC-HC-18 — el diagnóstico principal del expediente en una línea
 * («J02.9 Faringitis aguda»), para precargar el «Diagnóstico relacionado»
 * de las órdenes. Sin principal, el primero que haya; sin diagnósticos, null.
 */
export function principalDiagnosisLine(record: MedicalRecord): string | null {
  const data = record.sections.find((s) => s.key === "diagnoses")?.data;
  const items = data && Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const elegido = items.find((i) => i.role === "primary") ?? items[0];
  if (!elegido || typeof elegido.description !== "string") return null;
  const code = typeof elegido.icd10Code === "string" ? elegido.icd10Code : "";
  return code ? `${code} ${elegido.description}` : elegido.description;
}
