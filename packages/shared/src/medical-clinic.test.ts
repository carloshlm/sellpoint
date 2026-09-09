import { describe, expect, it } from "vitest";
import {
  allergiesSchema,
  anthropometrySchema,
  CARRIED_FORWARD_SECTION_KEYS,
  currentMedicationsSchema,
  familyHistorySchema,
  generalDataSchema,
  gynecoObstetricHistorySchema,
  MEDICAL_ORDER_KINDS,
  MEDICAL_RECORD_SECTION_GROUPS,
  MEDICAL_RECORD_SECTION_SCHEMAS,
  MEDICAL_RECORD_SECTIONS,
  MEDICAL_RECORD_STATUSES,
  medicalRecordLock,
  medicalRecordSectionKeySchema,
  nonPathologicalHistorySchema,
  pathologicalHistorySchema,
  physicalExamSchema,
  studyResultsSchema,
  systemsReviewSchema,
  vitalSignsSchema,
} from "./medical-clinic";

/**
 * F9-CLINIC-01 — el catálogo de secciones de la historia clínica es CÓDIGO
 * compartido: el API valida con él al escribir y el web pinta con él. Una
 * sección sin schema no es funcional, y una funcional sin schema no existe.
 */
describe("catálogo de secciones de la historia clínica (F9-CLINIC-01)", () => {
  /**
   * F9-CLINIC-HC-01 — 26 claves, no 32 (Carlos, 2026-09-08). Exploración baja
   * de 7 a 4 y Evaluación y plan de 8 a 5: lo que se fusionó no se perdió,
   * se dejó de repartir en viajes de ida y vuelta.
   */
  it("son 26 claves únicas, en el orden de Carlos, repartidas en los cuatro grupos", () => {
    const claves = MEDICAL_RECORD_SECTIONS.map((s) => s.key);
    expect(claves).toHaveLength(26);
    expect(new Set(claves).size).toBe(26);
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
    expect(MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "examination")).toHaveLength(4);
    expect(MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "assessment_plan")).toHaveLength(5);
    expect(MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "documents")).toHaveLength(7);
  });

  it("las siete claves fusionadas ya no existen, y los diagnósticos son UNA sola", () => {
    const claves: string[] = MEDICAL_RECORD_SECTIONS.map((s) => s.key);
    for (const muerta of [
      "systems_exam",
      "lab_studies",
      "imaging_studies",
      "primary_diagnosis",
      "secondary_diagnoses",
      "differential_diagnosis",
      "recommendations",
    ]) {
      expect(claves).not.toContain(muerta);
    }
    expect(claves).toContain("diagnoses");
    expect(medicalRecordSectionKeySchema.safeParse("primary_diagnosis").success).toBe(false);
  });

  /**
   * Somatometría PRIMERO: es lo que la asistente ya midió cuando el paciente
   * entra al consultorio (Carlos, 2026-09-08).
   */
  it("Exploración empieza por Somatometría y sigue con Signos Vitales", () => {
    const examen = MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "examination").map(
      (s) => s.key,
    );
    expect(examen).toEqual(["anthropometry", "vital_signs", "physical_exam", "study_results"]);
  });

  it("Evaluación y plan: impresión, diagnósticos, tratamiento, plan y seguimiento", () => {
    const plan = MEDICAL_RECORD_SECTIONS.filter((s) => s.group === "assessment_plan").map(
      (s) => s.key,
    );
    expect(plan).toEqual([
      "diagnostic_impression",
      "diagnoses",
      "treatment",
      "management_plan",
      "follow_up",
    ]);
  });

  /**
   * Los antecedentes son del PACIENTE, no de la consulta: la consulta nueva
   * los hereda. Signos vitales y diagnósticos NO: esos son del día.
   */
  it("siete secciones se heredan de la consulta anterior, y solo esas", () => {
    expect(CARRIED_FORWARD_SECTION_KEYS).toEqual([
      "general_data",
      "family_history",
      "pathological_history",
      "non_pathological_history",
      "gyneco_obstetric_history",
      "allergies",
      "current_medications",
    ]);
    for (const seccion of MEDICAL_RECORD_SECTIONS) {
      expect(seccion.carriedForward).toBe(
        (CARRIED_FORWARD_SECTION_KEYS as readonly string[]).includes(seccion.key),
      );
    }
  });

  it("solo los antecedentes gineco-obstétricos se piden por sexo", () => {
    const conSexo = MEDICAL_RECORD_SECTIONS.filter((s) => s.sexes !== undefined);
    expect(conSexo.map((s) => s.key)).toEqual(["gyneco_obstetric_history"]);
    expect(conSexo[0]?.sexes).toEqual(["F", "X"]);
  });

  it("interrogatorio y exploración son funcionales (14), y schema ⇔ funcional", () => {
    const funcionales = MEDICAL_RECORD_SECTIONS.filter((s) => s.functional).map((s) => s.key);
    expect(funcionales).toEqual([
      "general_data",
      "chief_complaint",
      "current_illness",
      "family_history",
      "pathological_history",
      "non_pathological_history",
      "gyneco_obstetric_history",
      "allergies",
      "current_medications",
      "systems_review",
      "anthropometry",
      "vital_signs",
      "physical_exam",
      "study_results",
    ]);
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
    // F9-CLINIC-HC-13: lo que la NOM 6.1.1 pide en la ficha de identificación.
    expect(generalDataSchema.parse({ ethnicGroup: "Náhuatl", religion: "Católica" })).toEqual({
      ethnicGroup: "Náhuatl",
      religion: "Católica",
    });
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

/**
 * F9-CLINIC-HC-06..12 — los schemas del interrogatorio. Lo negado se guarda
 * explícito y solo; lo capturado exige su dato principal por fila; `{}`
 * sigue valiendo porque guardar nada es Pendiente.
 */
describe("interrogatorio: antecedentes y aparatos y sistemas", () => {
  it("AHF: negados o enfermedades con al menos un parentesco; «otra» pide el nombre", () => {
    expect(familyHistorySchema.parse({ negated: true })).toEqual({ negated: true });
    expect(familyHistorySchema.safeParse({ negated: true, conditions: [] }).success).toBe(false);
    expect(
      familyHistorySchema.parse({
        conditions: [{ condition: "diabetes", relatives: ["mother", "father"] }],
      }),
    ).toEqual({ conditions: [{ condition: "diabetes", relatives: ["mother", "father"] }] });
    expect(
      familyHistorySchema.safeParse({ conditions: [{ condition: "diabetes", relatives: [] }] })
        .success,
    ).toBe(false);
    expect(
      familyHistorySchema.safeParse({ conditions: [{ condition: "other", relatives: ["father"] }] })
        .success,
    ).toBe(false);
    expect(
      familyHistorySchema.safeParse({
        conditions: [{ condition: "other", relatives: ["father"], otherLabel: "Lupus" }],
      }).success,
    ).toBe(true);
    expect(familyHistorySchema.parse({})).toEqual({});
  });

  it("APP: año futuro rechaza; transfusión sin haberla tenido no lleva detalles; una cirugía sin nombre rechaza", () => {
    expect(pathologicalHistorySchema.parse({ negated: true })).toEqual({ negated: true });
    expect(
      pathologicalHistorySchema.parse({
        childhood: ["chickenpox"],
        chronic: [{ condition: "diabetes", sinceYear: 2019, treatment: "Metformina" }],
        surgeries: [{ procedure: "Apendicectomía", year: 2015 }],
        transfusions: { had: false },
      }),
    ).toMatchObject({ surgeries: [{ procedure: "Apendicectomía", year: 2015 }] });
    expect(
      pathologicalHistorySchema.safeParse({ surgeries: [{ procedure: "x", year: 2999 }] }).success,
    ).toBe(false);
    expect(
      pathologicalHistorySchema.safeParse({ surgeries: [{ procedure: "x", year: 999 }] }).success,
    ).toBe(false);
    expect(
      pathologicalHistorySchema.safeParse({ transfusions: { had: false, reaction: "Fiebre" } })
        .success,
    ).toBe(false);
    expect(pathologicalHistorySchema.safeParse({ surgeries: [{ procedure: "" }] }).success).toBe(
      false,
    );
    expect(pathologicalHistorySchema.safeParse({ chronic: [{ condition: "other" }] }).success).toBe(
      false,
    );
  });

  it("APNP: quien nunca fumó no lleva cigarros ni años; residentes 0 rechaza; tipo sanguíneo del catálogo", () => {
    expect(
      nonPathologicalHistorySchema.parse({
        smoking: { status: "current", cigarettesPerDay: 20, years: 10 },
        bloodType: "O+",
        housing: { type: "own", services: ["water", "electricity"], residents: 4 },
      }),
    ).toMatchObject({ bloodType: "O+" });
    expect(
      nonPathologicalHistorySchema.safeParse({ smoking: { status: "never", cigarettesPerDay: 5 } })
        .success,
    ).toBe(false);
    expect(nonPathologicalHistorySchema.safeParse({ housing: { residents: 0 } }).success).toBe(
      false,
    );
    expect(nonPathologicalHistorySchema.safeParse({ bloodType: "Z+" }).success).toBe(false);
    expect(nonPathologicalHistorySchema.parse({})).toEqual({});
  });

  it("AGO: FUM futura rechaza; menarca a los 7 rechaza; G/P/A/C enteros", () => {
    expect(
      gynecoObstetricHistorySchema.parse({
        menarcheAge: 12,
        gestations: 2,
        births: 1,
        abortions: 0,
        cesareans: 1,
        contraception: "iud",
        papSmear: { date: "2026-01-15", result: "normal" },
        pregnant: false,
      }),
    ).toMatchObject({ gestations: 2, cesareans: 1 });
    expect(gynecoObstetricHistorySchema.safeParse({ lastPeriodDate: "2999-01-01" }).success).toBe(
      false,
    );
    expect(gynecoObstetricHistorySchema.safeParse({ menarcheAge: 7 }).success).toBe(false);
    expect(gynecoObstetricHistorySchema.safeParse({ births: 1.5 }).success).toBe(false);
  });

  it("alergias: negadas o una lista con sustancia; sin sustancia rechaza; lista vacía rechaza", () => {
    expect(allergiesSchema.parse({ negated: true })).toEqual({ negated: true });
    expect(
      allergiesSchema.parse({
        items: [
          { kind: "drug", substance: "Penicilina", reaction: "Urticaria", severity: "severe" },
        ],
      }),
    ).toMatchObject({ items: [{ substance: "Penicilina" }] });
    expect(allergiesSchema.safeParse({ items: [] }).success).toBe(false);
    expect(allergiesSchema.safeParse({ items: [{ kind: "food", substance: " " }] }).success).toBe(
      false,
    );
  });

  it("medicamentos actuales: ninguno o una lista con nombre; `none` no convive con la lista", () => {
    expect(currentMedicationsSchema.parse({ none: true })).toEqual({ none: true });
    expect(
      currentMedicationsSchema.parse({ items: [{ name: "Metformina", dose: "850 mg" }] }),
    ).toEqual({ items: [{ name: "Metformina", dose: "850 mg" }] });
    expect(currentMedicationsSchema.safeParse({ none: true, items: [{ name: "x" }] }).success).toBe(
      false,
    );
    expect(currentMedicationsSchema.safeParse({ items: [{ name: "" }] }).success).toBe(false);
  });

  it("aparatos y sistemas: por sistema, negado explícito o hallazgos con texto; un sistema inventado rechaza", () => {
    expect(systemsReviewSchema.parse({ negated: true })).toEqual({ negated: true });
    expect(
      systemsReviewSchema.parse({
        systems: { respiratory: { normal: true }, digestive: { findings: "Dolor epigástrico" } },
      }),
    ).toEqual({
      systems: { respiratory: { normal: true }, digestive: { findings: "Dolor epigástrico" } },
    });
    expect(
      systemsReviewSchema.safeParse({ systems: { digestive: { findings: "" } } }).success,
    ).toBe(false);
    expect(systemsReviewSchema.safeParse({ systems: { liver: { normal: true } } }).success).toBe(
      false,
    );
    expect(
      systemsReviewSchema.safeParse({ systems: { digestive: { normal: false } } }).success,
    ).toBe(false);
  });
});

/** F9-CLINIC-HC-14..17 — los schemas de la exploración: números, no strings; lo derivado no viaja. */
describe("exploración: somatometría, signos vitales, exploración física y resultados", () => {
  it("somatometría: peso y talla con un decimal; peso 0 rechaza; dos decimales rechazan; el IMC no cabe", () => {
    expect(anthropometrySchema.parse({ weightKg: 68.5, heightCm: 165 })).toEqual({
      weightKg: 68.5,
      heightCm: 165,
    });
    expect(anthropometrySchema.safeParse({ weightKg: 0 }).success).toBe(false);
    expect(anthropometrySchema.safeParse({ heightCm: 165.55 }).success).toBe(false);
    expect(anthropometrySchema.safeParse({ weightKg: "68" }).success).toBe(false);
    expect(anthropometrySchema.safeParse({ weightKg: 68, bmi: 25 }).success).toBe(false);
  });

  it("signos vitales: enteros en rango; la diastólica va por debajo de la sistólica; temperatura con un decimal", () => {
    expect(
      vitalSignsSchema.parse({
        systolic: 120,
        diastolic: 80,
        heartRate: 72,
        temperatureC: 36.6,
        oxygenSaturation: 98,
        painScale: 3,
      }),
    ).toMatchObject({ systolic: 120, diastolic: 80 });
    expect(vitalSignsSchema.safeParse({ systolic: 80, diastolic: 120 }).success).toBe(false);
    expect(vitalSignsSchema.safeParse({ temperatureC: 36.55 }).success).toBe(false);
    expect(vitalSignsSchema.safeParse({ heartRate: 72.5 }).success).toBe(false);
    expect(vitalSignsSchema.safeParse({ painScale: 11 }).success).toBe(false);
    expect(vitalSignsSchema.parse({ diastolic: 80 })).toEqual({ diastolic: 80 });
  });

  it("exploración física: habitus libre; por región normal explícito o hallazgos; región inventada rechaza", () => {
    expect(
      physicalExamSchema.parse({
        habitus: "Íntegro, cooperador",
        regions: { abdomen: { findings: "Dolor en FID" }, skin: { normal: true } },
      }),
    ).toEqual({
      habitus: "Íntegro, cooperador",
      regions: { abdomen: { findings: "Dolor en FID" }, skin: { normal: true } },
    });
    expect(physicalExamSchema.safeParse({ regions: { liver: { normal: true } } }).success).toBe(
      false,
    );
    expect(physicalExamSchema.safeParse({ regions: { abdomen: { findings: "" } } }).success).toBe(
      false,
    );
  });

  it("resultados: cada fila con nombre y resultado; fecha futura rechaza; studyId vacío rechaza", () => {
    expect(
      studyResultsSchema.parse({
        items: [
          {
            kind: "lab",
            name: "Biometría hemática",
            date: "2026-09-01",
            result: "Hb 13.5",
            interpretation: "normal",
          },
        ],
      }),
    ).toMatchObject({ items: [{ name: "Biometría hemática" }] });
    expect(
      studyResultsSchema.safeParse({ items: [{ kind: "lab", name: "BH", result: "" }] }).success,
    ).toBe(false);
    expect(
      studyResultsSchema.safeParse({
        items: [{ kind: "lab", name: "BH", result: "x", date: "2999-01-01" }],
      }).success,
    ).toBe(false);
    expect(
      studyResultsSchema.safeParse({
        items: [{ kind: "lab", name: "BH", result: "x", studyId: "" }],
      }).success,
    ).toBe(false);
    expect(studyResultsSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
