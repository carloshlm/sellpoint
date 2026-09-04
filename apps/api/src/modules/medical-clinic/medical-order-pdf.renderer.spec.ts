import {
  buildMedicalOrderDefinition,
  type MedicalOrderPdfInput,
} from "./medical-order-pdf.renderer";

/**
 * F9-CLINIC-24 — el documento carta de la orden. Se testea el
 * `docDefinition`, no el binario (mismo molde que `document-pdf.renderer.spec`).
 */
describe("buildMedicalOrderDefinition (F9-CLINIC-24)", () => {
  const t = (key: string) => key;
  const textos = (definition: unknown) => JSON.stringify(definition);

  const base: MedicalOrderPdfInput = {
    tenant: {
      name: "Consultorio San Rafael",
      legalName: "SAN RAFAEL SALUD S.A. DE C.V.",
      address: "Av. Siempre Viva 742",
      phone: "+525512345678",
      timezone: "America/Mexico_City",
    },
    record: {
      folio: "HCL-000012",
      consultationDate: "2026-09-03",
      patientName: "Ana Pérez Luna",
      age: 36,
      sex: "F",
      doctorName: "Gregorio House",
    },
    order: {
      kind: "prescription",
      folio: "COT-000007",
      createdAt: new Date("2026-09-03T15:00:00.000Z"),
      diagnosis: "Faringitis",
      indications: "Reposo 3 días",
      lines: [
        { description: "Paracetamol — Caja", quantity: "2", dosage: "1 cada 8 h" },
        { description: "Amoxicilina — Caja", quantity: "1", dosage: null },
      ],
    },
    locale: "es",
  };

  it("es tamaño carta con el negocio, el paciente, el médico y el expediente", () => {
    const def = buildMedicalOrderDefinition(base, t);
    expect(def.pageSize).toBe("LETTER");
    const json = textos(def);
    expect(json).toContain("SAN RAFAEL SALUD S.A. DE C.V.");
    expect(json).toContain("Ana Pérez Luna");
    expect(json).toContain("Gregorio House");
    expect(json).toContain("HCL-000012");
    expect(json).toContain("COT-000007");
    expect(json).toContain("medical_clinic.pdf.sex_F");
  });

  it("el título cambia por tipo", () => {
    expect(textos(buildMedicalOrderDefinition(base, t))).toContain(
      "medical_clinic.pdf.title_prescription",
    );
    expect(
      textos(
        buildMedicalOrderDefinition({ ...base, order: { ...base.order, kind: "lab_order" } }, t),
      ),
    ).toContain("medical_clinic.pdf.title_lab_order");
    expect(
      textos(
        buildMedicalOrderDefinition(
          { ...base, order: { ...base.order, kind: "diagnostic_order" } },
          t,
        ),
      ),
    ).toContain("medical_clinic.pdf.title_diagnostic_order");
  });

  it("la receta lista cada medicamento con su indicación, más diagnóstico e indicaciones", () => {
    const json = textos(buildMedicalOrderDefinition(base, t));
    expect(json).toContain("Paracetamol — Caja");
    expect(json).toContain("1 cada 8 h");
    expect(json).toContain("Amoxicilina — Caja");
    expect(json).toContain("Faringitis");
    expect(json).toContain("Reposo 3 días");
    expect(json).toContain("medical_clinic.pdf.signature");
  });

  it("NINGUNA orden menciona la caja, se cobre o no", () => {
    // Carlos, 2026-09-04: la receta va a la farmacia y la orden de estudios,
    // al laboratorio; el papel clínico no le habla al paciente de dinero. El
    // folio ya está impreso, y con él la caja encuentra la cotización.
    for (const kind of ["prescription", "lab_order", "diagnostic_order"] as const) {
      const definicion = buildMedicalOrderDefinition(
        { ...base, order: { ...base.order, kind } },
        t,
      );
      expect(textos(definicion)).not.toContain("charge_at_register");
    }
  });

  it("una orden sin cobro imprime su folio propio igual", () => {
    const sinCobro = buildMedicalOrderDefinition(
      {
        ...base,
        order: { ...base.order, kind: "lab_order", folio: "ORM-000003" },
      },
      t,
    );
    expect(textos(sinCobro)).toContain("ORM-000003");
  });
});
