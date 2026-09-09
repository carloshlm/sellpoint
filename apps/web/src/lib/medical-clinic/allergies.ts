/**
 * F9-CLINIC-HC-13 — las alergias en una línea, para el encabezado y la
 * tarjeta. `t` llega de afuera (función pura, como `summaryOf`).
 */
export function allergiesLine(
  data: Record<string, unknown> | null | undefined,
  t: (key: string) => string,
): { kind: "negated" | "items"; text: string } | null {
  if (!data) return null;
  if (data.negated === true) {
    return { kind: "negated", text: t("medicalClinic.forms.allergies.negated") };
  }
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const partes = items.flatMap((item) => {
    const substance = typeof item.substance === "string" ? item.substance.trim() : "";
    if (!substance) return [];
    const severity = typeof item.severity === "string" ? item.severity : "";
    return [
      severity
        ? `${substance} (${t(`medicalClinic.forms.allergies.severityOptions.${severity}`)})`
        : substance,
    ];
  });
  return partes.length > 0 ? { kind: "items", text: partes.join(" · ") } : null;
}
