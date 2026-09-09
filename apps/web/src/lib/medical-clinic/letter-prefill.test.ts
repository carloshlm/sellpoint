import { expediente } from "@/test/medical-clinic-fixture";
import { letterPrefill, primaryDiagnosis } from "./letter-prefill";

/**
 * F9-CLINIC-DOC-03 — «Traer del expediente» compone la carta con lo que ya
 * se capturó; nunca inventa y nunca decide pisar (eso es del formulario).
 */
describe("letterPrefill (F9-CLINIC-DOC-03)", () => {
  it("trae padecimiento actual, diagnóstico principal con CIE-10 y tratamiento farmacológico", () => {
    const record = expediente(
      {},
      {
        current_illness: { narrative: "Fiebre de tres días" },
        diagnoses: {
          items: [
            { role: "secondary", description: "Otitis" },
            { role: "primary", description: "Faringitis aguda", icd10Code: "J02.9" },
          ],
        },
        treatment: { pharmacological: "Amoxicilina 500 mg cada 8 h" },
      },
    );
    expect(letterPrefill(record.sections)).toEqual({
      clinicalSummary: "Fiebre de tres días",
      diagnosis: "Faringitis aguda",
      icd10Code: "J02.9",
      treatment: "Amoxicilina 500 mg cada 8 h",
    });
  });

  it("sin padecimiento cae al motivo de consulta; sin principal toma el primero; sin nada, null", () => {
    expect(
      letterPrefill(
        expediente(
          {},
          {
            chief_complaint: { complaint: "Tos" },
            diagnoses: { items: [{ role: "differential", description: "Mononucleosis" }] },
          },
        ).sections,
      ),
    ).toEqual({
      clinicalSummary: "Tos",
      diagnosis: "Mononucleosis",
      icd10Code: null,
      treatment: null,
    });
    expect(letterPrefill(expediente().sections)).toEqual({
      clinicalSummary: null,
      diagnosis: null,
      icd10Code: null,
      treatment: null,
    });
    expect(primaryDiagnosis(expediente({}, { diagnoses: { items: [] } }).sections)).toBeNull();
  });
});
