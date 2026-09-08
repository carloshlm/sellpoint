import { describe, expect, it } from "vitest";
import {
  bmi,
  bmiCategory,
  expectedDeliveryDate,
  parseMeasure,
  smokingIndex,
  VITAL_SIGN_RANGES,
  vitalSignFlag,
} from "./medical-measures";

/**
 * F9-CLINIC-HC-02 — lo derivado se CALCULA, no se guarda. Estas funciones
 * viven en shared para que el web las pinte y el API (o un reporte) las
 * repita sin reescribir la fórmula.
 */
describe("parseMeasure", () => {
  it("acepta enteros y decimales con punto, dentro del máximo de decimales", () => {
    expect(parseMeasure("68", 1)).toBe(68);
    expect(parseMeasure("68.5", 1)).toBe(68.5);
    expect(parseMeasure("36.6", 1)).toBe(36.6);
    expect(parseMeasure("120", 0)).toBe(120);
  });

  it("rechaza vacío, coma, letras y más decimales de los permitidos", () => {
    expect(parseMeasure("", 1)).toBeNull();
    expect(parseMeasure("36,5", 1)).toBeNull();
    expect(parseMeasure("abc", 1)).toBeNull();
    expect(parseMeasure("36.55", 1)).toBeNull();
    expect(parseMeasure("120.5", 0)).toBeNull();
    expect(parseMeasure("-5", 1)).toBeNull();
  });
});

describe("IMC y clasificación OMS", () => {
  it("68 kg y 165 cm dan 25.0, sobrepeso", () => {
    expect(bmi(68, 165)).toBe(25);
    expect(bmiCategory(25)).toBe("overweight");
  });

  it("los cortes OMS: 18.5, 25 y 30 (el borde inferior pertenece a la categoría de arriba)", () => {
    expect(bmiCategory(18.4)).toBe("underweight");
    expect(bmiCategory(18.5)).toBe("normal");
    expect(bmiCategory(24.9)).toBe("normal");
    expect(bmiCategory(25)).toBe("overweight");
    expect(bmiCategory(29.9)).toBe("overweight");
    expect(bmiCategory(30)).toBe("obesity");
  });

  it("sin talla o con talla cero no hay IMC", () => {
    expect(bmi(68, 0)).toBeNull();
    expect(bmi(null, 165)).toBeNull();
    expect(bmi(68, null)).toBeNull();
  });

  it("redondea a un decimal", () => {
    expect(bmi(70, 172)).toBe(23.7);
  });
});

describe("índice tabáquico", () => {
  it("20 cigarros al día por 10 años son 10 paquetes-año", () => {
    expect(smokingIndex(20, 10)).toBe(10);
  });

  it("redondea a un decimal y sin alguno de los dos datos no hay índice", () => {
    expect(smokingIndex(5, 3)).toBe(0.8);
    expect(smokingIndex(null, 10)).toBeNull();
    expect(smokingIndex(20, null)).toBeNull();
    expect(smokingIndex(0, 10)).toBeNull();
  });
});

describe("fecha probable de parto (Naegele)", () => {
  it("FUM 2026-01-01 → 2026-10-08 (+280 días)", () => {
    expect(expectedDeliveryDate("2026-01-01")).toBe("2026-10-08");
  });

  it("cruza el año y respeta el bisiesto", () => {
    expect(expectedDeliveryDate("2027-06-15")).toBe("2028-03-21");
    expect(expectedDeliveryDate("2023-06-15")).toBe("2024-03-21");
  });

  it("una fecha que no es fecha no da nada", () => {
    expect(expectedDeliveryDate("")).toBeNull();
    expect(expectedDeliveryDate("2026-13-01")).toBeNull();
  });
});

describe("semáforo de signos vitales (adulto)", () => {
  it("dentro del rango es normal; fuera, alto o bajo", () => {
    expect(vitalSignFlag("systolic", 118)).toBe("normal");
    expect(vitalSignFlag("systolic", 150)).toBe("high");
    expect(vitalSignFlag("systolic", 85)).toBe("low");
    expect(vitalSignFlag("diastolic", 95)).toBe("high");
    expect(vitalSignFlag("heartRate", 72)).toBe("normal");
    expect(vitalSignFlag("heartRate", 110)).toBe("high");
    expect(vitalSignFlag("respiratoryRate", 24)).toBe("high");
    expect(vitalSignFlag("temperatureC", 38.2)).toBe("high");
    expect(vitalSignFlag("temperatureC", 35.9)).toBe("low");
    expect(vitalSignFlag("oxygenSaturation", 93)).toBe("low");
    expect(vitalSignFlag("oxygenSaturation", 98)).toBe("normal");
    expect(vitalSignFlag("capillaryGlucoseMgDl", 160)).toBe("high");
  });

  it("el dolor no tiene rango: siempre normal, es lo que el paciente dice", () => {
    expect(vitalSignFlag("painScale", 9)).toBe("normal");
  });

  it("los rangos son los publicados para adulto", () => {
    expect(VITAL_SIGN_RANGES.systolic).toEqual({ min: 90, max: 139 });
    expect(VITAL_SIGN_RANGES.diastolic).toEqual({ min: 60, max: 89 });
    expect(VITAL_SIGN_RANGES.heartRate).toEqual({ min: 60, max: 100 });
    expect(VITAL_SIGN_RANGES.respiratoryRate).toEqual({ min: 12, max: 20 });
    expect(VITAL_SIGN_RANGES.temperatureC).toEqual({ min: 36, max: 37.5 });
    expect(VITAL_SIGN_RANGES.oxygenSaturation).toEqual({ min: 95, max: 100 });
    expect(VITAL_SIGN_RANGES.capillaryGlucoseMgDl).toEqual({ min: 70, max: 140 });
  });
});
