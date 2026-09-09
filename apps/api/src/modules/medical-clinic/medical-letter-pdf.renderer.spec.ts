import {
  buildMedicalLetterDefinition,
  type MedicalLetterPdfInput,
} from "./medical-letter-pdf.renderer";

/**
 * F9-CLINIC-DOC-05 — la carta de referencia / solicitud de interconsulta.
 * Se testea el `docDefinition`, no el binario (mismo molde que la orden).
 */
describe("buildMedicalLetterDefinition (F9-CLINIC-DOC-05)", () => {
  const t = (key: string) => key;
  const textos = (definition: unknown) => JSON.stringify(definition);

  const base: MedicalLetterPdfInput = {
    tenant: {
      name: "Consultorio San Rafael",
      legalName: "SAN RAFAEL SALUD S.A. DE C.V.",
      address: "Av. Siempre Viva 742",
      phone: "+525512345678",
      timezone: "America/Mexico_City",
      showBusinessName: true,
      showAddress: true,
      showPhone: true,
    },
    record: {
      folio: "HCL-000012",
      consultationDate: "2026-09-09",
      patientName: "Ana Pérez Luna",
      age: 36,
      sex: "F",
      doctorName: "Gregorio House",
    },
    letter: {
      kind: "referral",
      number: 1,
      priority: "urgent",
      facility: "Hospital General",
      service: "Cardiología",
      doctorName: "Dra. Ruiz",
      reason: "Soplo sistólico de reciente aparición",
      clinicalSummary: "Fiebre de tres días con dolor torácico",
      diagnosis: "Soplo cardiaco",
      icd10Code: "R01.1",
      treatment: "Paracetamol 500 mg",
    },
    locale: "es",
  };

  it("es tamaño carta con el negocio, el paciente, el médico, el expediente y su número", () => {
    const def = buildMedicalLetterDefinition(base, t);
    expect(def.pageSize).toBe("LETTER");
    const json = textos(def);
    expect(json).toContain("SAN RAFAEL SALUD S.A. DE C.V.");
    expect(json).toContain("Ana Pérez Luna");
    expect(json).toContain("Gregorio House");
    expect(json).toContain("HCL-000012 · medical_clinic.pdf.letter_referral 1");
    expect(json).toContain("medical_clinic.pdf.sex_F");
    expect(json).toContain("medical_clinic.pdf.signature");
    // La fecha es la de la consulta, en palabras y sin que el huso la corra.
    expect(json).toContain("9 de septiembre de 2026");
  });

  it("dice a quién va, el motivo, el resumen, el diagnóstico con su CIE-10 y la terapéutica", () => {
    const json = textos(buildMedicalLetterDefinition(base, t));
    expect(json).toContain("Hospital General · Cardiología · Dra. Ruiz");
    expect(json).toContain("Soplo sistólico de reciente aparición");
    expect(json).toContain("Fiebre de tres días con dolor torácico");
    expect(json).toContain("R01.1 Soplo cardiaco");
    expect(json).toContain("Paracetamol 500 mg");
    expect(json).toContain("medical_clinic.pdf.diagnosis_icd10");
  });

  it("el título cambia por tipo y la prioridad se dice como es", () => {
    expect(textos(buildMedicalLetterDefinition(base, t))).toContain(
      "medical_clinic.pdf.title_referral",
    );
    expect(textos(buildMedicalLetterDefinition(base, t))).toContain(
      "medical_clinic.pdf.priority_urgent",
    );
    const inter = buildMedicalLetterDefinition(
      { ...base, letter: { ...base.letter, kind: "interconsultation", priority: "routine" } },
      t,
    );
    expect(textos(inter)).toContain("medical_clinic.pdf.title_interconsultation");
    expect(textos(inter)).toContain("medical_clinic.pdf.letter_interconsultation 1");
    expect(textos(inter)).toContain("medical_clinic.pdf.priority_routine");
    expect(textos(inter)).not.toContain("medical_clinic.pdf.priority_urgent");
  });

  it("lo que no se capturó no deja un encabezado vacío", () => {
    const minima = buildMedicalLetterDefinition(
      {
        ...base,
        letter: {
          ...base.letter,
          facility: null,
          doctorName: null,
          clinicalSummary: null,
          diagnosis: null,
          icd10Code: null,
          treatment: null,
        },
      },
      t,
    );
    const json = textos(minima);
    expect(json).toContain("medical_clinic.pdf.letter_to: ");
    expect(json).toContain("Cardiología");
    expect(json).not.toContain("medical_clinic.pdf.clinical_summary");
    expect(json).not.toContain("medical_clinic.pdf.diagnosis_icd10");
    expect(json).not.toContain("medical_clinic.pdf.treatment_given");
  });

  /** F4-TICKETCFG-07 — la carta respeta nombre, dirección y teléfono. */
  it("con los tres apagados el encabezado del negocio queda vacío y el resto sigue", () => {
    const json = textos(
      buildMedicalLetterDefinition(
        {
          ...base,
          tenant: { ...base.tenant, showBusinessName: false, showAddress: false, showPhone: false },
        },
        t,
      ),
    );
    expect(json).not.toContain(base.tenant.legalName as string);
    expect(json).not.toContain(base.tenant.address as string);
    expect(json).not.toContain(base.tenant.phone as string);
    expect(json).toContain("HCL-000012");
    expect(json).toContain("Ana Pérez Luna");
  });
});
