import { summaryOf } from "./summary";

/** F9-CLINIC-WEB-16 — lo que la tarjeta completada dice en una línea. */
describe("summaryOf", () => {
  const t = (key: string) => key.split(".").at(-1) ?? key;

  it("Datos Generales: sexo y ocupación; Motivo y Padecimiento: los primeros 80 caracteres", () => {
    expect(summaryOf("general_data", { sex: "F", occupation: "Docente" }, t)).toBe("F · Docente");
    expect(summaryOf("chief_complaint", { complaint: "Dolor de garganta" }, t)).toBe(
      "Dolor de garganta",
    );
    const largo =
      "Inicia hace tres días con dolor faríngeo intenso que empeora al deglutir y se acompaña de fiebre";
    const resumen = summaryOf("current_illness", { narrative: largo }, t);
    expect(resumen?.length).toBeLessThanOrEqual(81);
    expect(resumen?.endsWith("…")).toBe(true);
    // Corta en palabra, no a media palabra.
    expect(resumen).toBe(
      "Inicia hace tres días con dolor faríngeo intenso que empeora al deglutir y se…",
    );
  });

  it("AHF: «Negados» o enfermedad: parentescos, con «otra» por su nombre", () => {
    expect(summaryOf("family_history", { negated: true }, t)).toBe("negated");
    expect(
      summaryOf(
        "family_history",
        {
          conditions: [
            { condition: "diabetes", relatives: ["mother", "father"] },
            { condition: "other", relatives: ["siblings"], otherLabel: "Lupus" },
          ],
        },
        t,
      ),
    ).toBe("diabetes: mother, father · Lupus: siblings");
  });

  it("APP: crónicas con año, cirugías con año y «+n» por lo demás", () => {
    expect(summaryOf("pathological_history", { negated: true }, t)).toBe("negated");
    expect(
      summaryOf(
        "pathological_history",
        {
          chronic: [{ condition: "diabetes", sinceYear: 2019 }],
          surgeries: [{ procedure: "Apendicectomía", year: 2015 }],
          childhood: ["chickenpox"],
          transfusions: { had: true },
        },
        t,
      ),
    ).toBe("diabetes (2019) · Apendicectomía 2015 · +2");
  });

  it("APNP: tabaco, alcohol, tipo sanguíneo y vacunas; AGO: GPAC, FUM, MPF y embarazo", () => {
    expect(
      summaryOf(
        "non_pathological_history",
        {
          smoking: { status: "current", cigarettesPerDay: 20, years: 10 },
          alcohol: { status: "occasional" },
          bloodType: "O+",
          immunizations: "complete",
        },
        t,
      ),
    ).toBe("summarySmokes · occasional · O+ · complete");
    expect(
      summaryOf(
        "gyneco_obstetric_history",
        {
          gestations: 2,
          births: 1,
          abortions: 0,
          cesareans: 1,
          lastPeriodDate: "2026-08-20",
          contraception: "iud",
          pregnant: true,
        },
        t,
      ),
    ).toBe("G2 P1 A0 C1 · summaryLastPeriod 2026-08-20 · iud · pregnant");
  });

  it("alergias, medicamentos y aparatos y sistemas", () => {
    expect(summaryOf("allergies", { negated: true }, t)).toBe("negated");
    expect(
      summaryOf(
        "allergies",
        { items: [{ substance: "Penicilina", severity: "severe" }, { substance: "Mariscos" }] },
        t,
      ),
    ).toBe("Penicilina (severe) · Mariscos");
    expect(summaryOf("current_medications", { none: true }, t)).toBe("none");
    expect(
      summaryOf(
        "current_medications",
        { items: [{ name: "Metformina", dose: "850 mg" }, { name: "Losartán" }] },
        t,
      ),
    ).toBe("Metformina 850 mg · Losartán");
    expect(
      summaryOf(
        "systems_review",
        {
          systems: {
            respiratory: { normal: true },
            skin: { normal: true },
            digestive: { findings: "Dolor epigástrico" },
          },
        },
        t,
      ),
    ).toBe("summaryNegated · digestive: Dolor epigástrico");
  });

  it("somatometría con IMC, signos vitales, exploración por regiones y resultados", () => {
    expect(summaryOf("anthropometry", { weightKg: 68, heightCm: 165 }, t)).toBe(
      "68 kg · 165 cm · IMC 25.0",
    );
    expect(
      summaryOf(
        "vital_signs",
        { systolic: 120, diastolic: 80, heartRate: 72, temperatureC: 36.6, oxygenSaturation: 98 },
        t,
      ),
    ).toBe("TA 120/80 · FC 72 · T 36.6 · SpO2 98");
    expect(
      summaryOf(
        "physical_exam",
        {
          regions: {
            skin: { normal: true },
            neck: { normal: true },
            abdomen: { findings: "Dolor en FID" },
          },
        },
        t,
      ),
    ).toBe("summaryNormal · abdomen: Dolor en FID");
    expect(
      summaryOf(
        "study_results",
        {
          items: [
            { kind: "lab", name: "BH", date: "2026-09-01", result: "x", interpretation: "normal" },
            { kind: "other", name: "ECG", result: "y" },
          ],
        },
        t,
      ),
    ).toBe("summaryCount · BH 2026-09-01 (normal)");
  });

  it("diagnósticos con el principal y el resto contado; plan con pronóstico; seguimiento con cita", () => {
    expect(
      summaryOf(
        "diagnoses",
        {
          items: [
            { role: "differential", description: "Mono" },
            { role: "primary", description: "Faringitis aguda", icd10Code: "J02.9" },
          ],
        },
        t,
      ),
    ).toBe("J02.9 Faringitis aguda (+1)");
    expect(summaryOf("management_plan", { prognosis: "good", plan: "Control" }, t)).toBe(
      "summaryPrognosis: good · Control",
    );
    expect(
      summaryOf("follow_up", { nextAppointmentDate: "2026-09-22", alarmSigns: "Fiebre" }, t),
    ).toBe("summaryAppointment 2026-09-22 · summaryAlarm: Fiebre");
    expect(summaryOf("treatment", { nonPharmacological: "Reposo" }, t)).toBe("Reposo");
  });

  it("Notas Médicas: cuántas y la última, con hora y tipo (F9-CLINIC-DOC-02)", () => {
    expect(
      summaryOf(
        "medical_notes",
        {
          items: [
            { time: "09:00", kind: "evolution", text: "Mejoría" },
            { time: "18:40", kind: "procedure", text: "Curación de herida en pierna derecha" },
          ],
        },
        t,
      ),
    ).toBe("summaryCount · 18:40 procedure: Curación de herida en pierna derecha");
    expect(summaryOf("medical_notes", { items: [] }, t)).toBeNull();
  });

  it("sin datos, o en una sección sin resumen, devuelve null", () => {
    expect(summaryOf("general_data", {}, t)).toBeNull();
    expect(summaryOf("chief_complaint", { onsetValue: 3 }, t)).toBeNull();
    expect(summaryOf("no_existe", { foo: "bar" }, t)).toBeNull();
  });
});
