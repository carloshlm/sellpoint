/**
 * F9-CLINIC-HC-02 — la aritmética clínica de la historia clínica.
 *
 * Nada de esto se PERSISTE: en el JSON de la sección viajan peso, talla,
 * cigarros al día, años, la FUM y las cifras medidas; el IMC, su categoría,
 * el índice tabáquico, la fecha probable de parto y el semáforo se calculan
 * al pintar. Guardar un derivado es guardar una mentira en potencia (cambia
 * el peso y el IMC guardado se queda viejo). Vive en shared para que el web
 * y cualquier reporte del API repitan exactamente la misma fórmula.
 *
 * Fuentes: IMC y cortes de la OMS (<18.5 bajo peso, 18.5–24.9 normal,
 * 25–29.9 sobrepeso, ≥30 obesidad); índice tabáquico = cigarros/día ÷ 20 ×
 * años (paquetes-año, umbral de riesgo ≥ 20); regla de Naegele (FUM + 280
 * días); rangos de signos vitales del adulto (TA normal < 140/90, FC 60–100,
 * FR 12–20, T 36–37.5 °C, SpO2 ≥ 95 %, glucemia capilar 70–140 mg/dL).
 * Los rangos son de ADULTO: para menores de 12 años el semáforo se apaga
 * (los percentiles pediátricos están pospuestos con nombre).
 */

/**
 * Un número tecleado: acepta enteros y decimales con PUNTO hasta
 * `maxDecimals`; rechaza vacío, coma, letras, negativos y de más. El gemelo
 * de `parseMoneyInput`, sin la escala fija del dinero.
 */
export function parseMeasure(raw: string, maxDecimals: number): number | null {
  const texto = raw.trim();
  const patron =
    maxDecimals <= 0
      ? /^\d+$/
      : new RegExp(`^(\\d+\\.?\\d{0,${maxDecimals}}|\\.\\d{1,${maxDecimals}})$`);
  if (!patron.test(texto)) return null;
  const valor = Number(texto);
  return Number.isFinite(valor) ? valor : null;
}

const unDecimal = (n: number): number => Math.round(n * 10) / 10;

/** kg / m², a un decimal. Sin peso, sin talla o talla cero → `null`. */
export function bmi(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg === null || heightCm === null || heightCm <= 0 || weightKg <= 0) return null;
  const metros = heightCm / 100;
  return unDecimal(weightKg / (metros * metros));
}

export const BMI_CATEGORIES = ["underweight", "normal", "overweight", "obesity"] as const;
export type BmiCategory = (typeof BMI_CATEGORIES)[number];

/** Cortes OMS; el borde inferior pertenece a la categoría de arriba (25.0 ya es sobrepeso). */
export function bmiCategory(value: number): BmiCategory {
  if (value < 18.5) return "underweight";
  if (value < 25) return "normal";
  if (value < 30) return "overweight";
  return "obesity";
}

/** Paquetes-año: cigarros/día ÷ 20 × años, a un decimal. Sin alguno de los dos, o cero, → `null`. */
export function smokingIndex(cigarettesPerDay: number | null, years: number | null): number | null {
  if (cigarettesPerDay === null || years === null || cigarettesPerDay <= 0 || years <= 0) {
    return null;
  }
  return unDecimal((cigarettesPerDay / 20) * years);
}

const ISO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Regla de Naegele: FUM + 280 días, en `YYYY-MM-DD`. Una fecha inválida → `null`. */
export function expectedDeliveryDate(lastPeriod: string): string | null {
  const partes = ISO_DIA.exec(lastPeriod);
  if (partes === null) return null;
  const [, a, m, d] = partes;
  const fecha = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  // Un «2026-13-01» se desborda al año siguiente: si no vuelve igual, no era fecha.
  if (fecha.toISOString().slice(0, 10) !== lastPeriod) return null;
  fecha.setUTCDate(fecha.getUTCDate() + 280);
  return fecha.toISOString().slice(0, 10);
}

export const VITAL_SIGN_KEYS = [
  "systolic",
  "diastolic",
  "heartRate",
  "respiratoryRate",
  "temperatureC",
  "oxygenSaturation",
  "capillaryGlucoseMgDl",
  "painScale",
] as const;
export type VitalSignKey = (typeof VITAL_SIGN_KEYS)[number];

/** Rango normal del adulto, inclusivo por los dos lados. El dolor no tiene: es lo que el paciente dice. */
export const VITAL_SIGN_RANGES: Readonly<
  Partial<Record<VitalSignKey, { readonly min: number; readonly max: number }>>
> = {
  systolic: { min: 90, max: 139 },
  diastolic: { min: 60, max: 89 },
  heartRate: { min: 60, max: 100 },
  respiratoryRate: { min: 12, max: 20 },
  temperatureC: { min: 36, max: 37.5 },
  oxygenSaturation: { min: 95, max: 100 },
  capillaryGlucoseMgDl: { min: 70, max: 140 },
};

export type VitalSignFlag = "low" | "normal" | "high";

export function vitalSignFlag(key: VitalSignKey, value: number): VitalSignFlag {
  const rango = VITAL_SIGN_RANGES[key];
  if (rango === undefined) return "normal";
  if (value < rango.min) return "low";
  if (value > rango.max) return "high";
  return "normal";
}
