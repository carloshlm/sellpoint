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

  it("sin datos, o en una sección sin resumen, devuelve null", () => {
    expect(summaryOf("general_data", {}, t)).toBeNull();
    expect(summaryOf("chief_complaint", { onsetValue: 3 }, t)).toBeNull();
    expect(summaryOf("attachments", { foo: "bar" }, t)).toBeNull();
  });
});
