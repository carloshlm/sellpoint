/**
 * F9-CLINIC-WEB-16 — lo que la tarjeta completada dice en una línea.
 *
 * Solo las secciones con formulario tienen resumen; el resto devuelve null y
 * la tarjeta no pinta nada. `t` llega de afuera para que esto siga siendo una
 * función pura testeable sin i18n.
 */
const MAX = 80;

function recorte(texto: string): string {
  const limpio = texto.trim();
  if (limpio.length <= MAX) return limpio;
  const trozo = limpio.slice(0, MAX);
  const espacio = trozo.lastIndexOf(" ");
  return `${(espacio > 0 ? trozo.slice(0, espacio) : trozo).trimEnd()}…`;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

export function summaryOf(
  key: string,
  data: Record<string, unknown> | null | undefined,
  t: (key: string) => string,
): string | null {
  if (!data) return null;
  switch (key) {
    case "general_data": {
      const sex = texto(data.sex);
      const partes = [
        sex ? t(`medicalClinic.forms.generalData.sexOptions.${sex}`) : null,
        texto(data.occupation),
      ].filter((p): p is string => p !== null);
      return partes.length > 0 ? partes.join(" · ") : null;
    }
    case "chief_complaint": {
      const complaint = texto(data.complaint);
      return complaint ? recorte(complaint) : null;
    }
    case "current_illness": {
      const narrative = texto(data.narrative);
      return narrative ? recorte(narrative) : null;
    }
    default:
      return null;
  }
}
