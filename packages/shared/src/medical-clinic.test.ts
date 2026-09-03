import { describe, expect, it } from "vitest";
import {
  generalDataSchema,
  MEDICAL_ORDER_KINDS,
  MEDICAL_RECORD_SECTION_GROUPS,
  MEDICAL_RECORD_SECTION_SCHEMAS,
  MEDICAL_RECORD_SECTIONS,
  MEDICAL_RECORD_STATUSES,
  medicalRecordLock,
  medicalRecordSectionKeySchema,
} from "./medical-clinic";

/**
 * F9-CLINIC-01 — el catálogo de secciones de la historia clínica es CÓDIGO
 * compartido: el API valida con él al escribir y el web pinta con él. Una
 * sección sin schema no es funcional, y una funcional sin schema no existe.
 */
describe("catálogo de secciones de la historia clínica (F9-CLINIC-01)", () => {
  it("son 32 claves únicas, en el orden de Carlos, repartidas en los cuatro grupos", () => {
    const claves = MEDICAL_RECORD_SECTIONS.map((s) => s.key);
    expect(claves).toHaveLength(32);
    expect(new Set(claves).size).toBe(32);
    expect(claves.slice(0, 3)).toEqual(["general_data", "chief_complaint", "current_illness"]);
    expect(claves.at(-1)).toBe("follow_up_appointments");
    expect(MEDICAL_RECORD_SECTION_GROUPS).toEqual([
      "interrogation",
      "examination",
      "assessment_plan",
      "documents",
    ]);
    for (const grupo of MEDICAL_RECORD_SECTION_GROUPS) {
      const ordenes = MEDICAL_RECORD_SECTIONS.filter((s) => s.group === grupo).map((s) => s.order);
      expect(ordenes).toEqual([...ordenes].sort((a, b) => a - b));
    }
    expect(MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "interrogation")).toHaveLength(10);
    expect(MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "examination")).toHaveLength(7);
    expect(MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "assessment_plan")).toHaveLength(8);
    expect(MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "documents")).toHaveLength(7);
  });

  it("exactamente tres son funcionales, y schema ⇔ funcional", () => {
    const funcionales = MEDICAL_RECORD_SECTIONS.filter((s) => s.functional).map((s) => s.key);
    expect(funcionales).toEqual(["general_data", "chief_complaint", "current_illness"]);
    for (const seccion of MEDICAL_RECORD_SECTIONS) {
      expect(MEDICAL_RECORD_SECTION_SCHEMAS[seccion.key] !== undefined).toBe(seccion.functional);
    }
  });

  it("el schema de claves acepta las del catálogo y rechaza el resto", () => {
    expect(medicalRecordSectionKeySchema.parse("allergies")).toBe("allergies");
    expect(() => medicalRecordSectionKeySchema.parse("no_existe")).toThrow();
  });

  it("Datos Generales: sexo F|M|X, todo opcional, teléfono de emergencia E.164", () => {
    expect(generalDataSchema.parse({})).toEqual({});
    expect(generalDataSchema.parse({ sex: "F", occupation: "Docente" })).toEqual({
      sex: "F",
      occupation: "Docente",
    });
    expect(generalDataSchema.safeParse({ sex: "Q" }).success).toBe(false);
    expect(generalDataSchema.safeParse({ emergencyContactPhone: "5512345678" }).success).toBe(
      false,
    );
    expect(generalDataSchema.safeParse({ emergencyContactPhone: "+525512345678" }).success).toBe(
      true,
    );
    // Sin claves inventadas: el JSON de la sección es la forma del schema.
    expect(generalDataSchema.safeParse({ foo: 1 }).success).toBe(false);
  });

  it("las órdenes son tres tipos", () => {
    expect(MEDICAL_ORDER_KINDS).toEqual(["prescription", "lab_order", "diagnostic_order"]);
  });
});

/**
 * F9-CLINIC-25 — el candado del expediente. Una sola función pura decide si
 * una historia clínica se puede seguir capturando: el API la usa para
 * responder 409 y el web solo pinta lo que el API le dice.
 */
describe("medicalRecordLock (F9-CLINIC-25)", () => {
  const HOY = "2026-09-04";

  it("los estados del expediente son abierta y cerrada", () => {
    expect(MEDICAL_RECORD_STATUSES).toEqual(["open", "closed"]);
  });

  it("una consulta abierta del día se puede capturar", () => {
    expect(medicalRecordLock({ status: "open", consultationDate: HOY }, HOY)).toBeNull();
  });

  it("una consulta abierta de otro día está vencida", () => {
    expect(medicalRecordLock({ status: "open", consultationDate: "2026-09-03" }, HOY)).toBe(
      "expired",
    );
    // Meses y años distintos: la comparación es de calendario, no de números sueltos.
    expect(medicalRecordLock({ status: "open", consultationDate: "2025-12-31" }, HOY)).toBe(
      "expired",
    );
  });

  it("cerrada gana sobre vencida: el motivo que se muestra es el cierre", () => {
    expect(medicalRecordLock({ status: "closed", consultationDate: HOY }, HOY)).toBe("closed");
    expect(medicalRecordLock({ status: "closed", consultationDate: "2026-09-01" }, HOY)).toBe(
      "closed",
    );
  });

  it("una fecha futura no se castiga: un reloj mal puesto no bloquea al médico", () => {
    expect(medicalRecordLock({ status: "open", consultationDate: "2026-09-05" }, HOY)).toBeNull();
  });
});
