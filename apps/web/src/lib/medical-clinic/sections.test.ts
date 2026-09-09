import { MEDICAL_RECORD_SECTIONS } from "@sellpoint/shared";
import en from "@/i18n/en/medicalClinic.json";
import es from "@/i18n/es/medicalClinic.json";
import { expediente } from "@/test/medical-clinic-fixture";
import {
  FUNCTIONAL_SECTION_KEYS,
  groupProgress,
  groupStatus,
  isSectionVisible,
  RECORD_CARDS,
  RECORD_GROUPS,
  sectionStatus,
  visibleCards,
} from "./sections";

/**
 * F9-CLINIC-WEB-09 — el catálogo de tarjetas del tablero y el estado
 * derivado. Las 26 secciones vienen de shared; las 4 de órdenes son de esta
 * pantalla. «En progreso» vive en el GRUPO: una tarjeta o está capturada o
 * no.
 */
describe("catálogo de tarjetas de la historia clínica", () => {
  it("cinco grupos en el orden de Carlos, 30 tarjetas, las 26 secciones primero en su orden", () => {
    expect(RECORD_GROUPS).toEqual([
      "interrogation",
      "examination",
      "assessment_plan",
      "orders",
      "documents",
    ]);
    expect(RECORD_CARDS).toHaveLength(30);
    const secciones = RECORD_CARDS.filter((c) => c.kind === "section").map((c) => c.key);
    expect(secciones).toEqual(MEDICAL_RECORD_SECTIONS.map((s) => s.key));
    expect(RECORD_CARDS.filter((c) => c.group === "orders").map((c) => c.key)).toEqual([
      "prescription",
      "lab_order",
      "diagnostic_order",
      "orders_list",
    ]);
    expect(FUNCTIONAL_SECTION_KEYS).toEqual([
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
  });

  it("toda tarjeta tiene título en es y en en", () => {
    for (const card of RECORD_CARDS) {
      expect(
        (es.sections as unknown as Record<string, { title?: string }>)[card.key]?.title,
      ).toBeTruthy();
      expect(
        (en.sections as unknown as Record<string, { title?: string }>)[card.key]?.title,
      ).toBeTruthy();
    }
  });

  it("sectionStatus: ausente → pending; con datos → completed; guardada vacía → pending; el server manda", () => {
    expect(sectionStatus(expediente(), "general_data")).toBe("pending");
    expect(sectionStatus(expediente({}, { general_data: { sex: "F" } }), "general_data")).toBe(
      "completed",
    );
    expect(sectionStatus(expediente({}, { general_data: {} }), "general_data")).toBe("pending");
    const servidor = expediente();
    servidor.sections.push({
      key: "allergies",
      group: "interrogation",
      order: 8,
      functional: false,
      status: "completed",
      data: null,
      updatedAt: null,
      carriedFrom: null,
    });
    expect(sectionStatus(servidor, "allergies")).toBe("completed");
  });

  it("groupStatus: ninguna → pending; algunas → inProgress; todas las funcionales → completed", () => {
    expect(groupStatus(expediente(), "interrogation")).toBe("pending");
    expect(groupStatus(expediente({}, { general_data: { sex: "F" } }), "interrogation")).toBe(
      "inProgress",
    );
    expect(groupProgress(expediente({}, { general_data: { sex: "F" } }), "interrogation")).toEqual({
      done: 1,
      total: 10,
    });
    expect(
      groupStatus(
        expediente(
          {},
          {
            general_data: { sex: "F" },
            chief_complaint: { complaint: "x" },
            current_illness: { narrative: "y" },
            family_history: { negated: true },
            pathological_history: { negated: true },
            non_pathological_history: { bloodType: "O+" },
            gyneco_obstetric_history: { menarcheAge: 12 },
            allergies: { negated: true },
            current_medications: { none: true },
            systems_review: { negated: true },
          },
        ),
        "interrogation",
      ),
    ).toBe("completed");
    // Un grupo sin secciones funcionales todavía no puede estar «en progreso».
    expect(groupStatus(expediente(), "documents")).toBe("pending");
  });
});

/** F9-CLINIC-HC-13 — el sexo decide qué se PIDE; el dato decide qué se MUESTRA. */
describe("visibilidad por sexo", () => {
  const conSexo = (sex: "F" | "M" | "X" | null, secciones = {}) =>
    expediente({ patient: { ...expediente().patient, sex } }, secciones);

  it("AGO se pide a F y X, y sin sexo; a M no", () => {
    expect(isSectionVisible(conSexo("F"), "gyneco_obstetric_history")).toBe(true);
    expect(isSectionVisible(conSexo("X"), "gyneco_obstetric_history")).toBe(true);
    expect(isSectionVisible(conSexo(null), "gyneco_obstetric_history")).toBe(true);
    expect(isSectionVisible(conSexo("M"), "gyneco_obstetric_history")).toBe(false);
    expect(isSectionVisible(conSexo("M"), "allergies")).toBe(true);
  });

  it("a M con AGO capturado se le sigue mostrando: esconder no es borrar", () => {
    expect(
      isSectionVisible(
        conSexo("M", { gyneco_obstetric_history: { menarcheAge: 12 } }),
        "gyneco_obstetric_history",
      ),
    ).toBe(true);
  });

  it("las tarjetas visibles y el progreso del grupo lo respetan", () => {
    expect(visibleCards(conSexo("M"))).toHaveLength(29);
    expect(visibleCards(conSexo("F"))).toHaveLength(30);
    expect(groupProgress(conSexo("M"), "interrogation")).toEqual({ done: 0, total: 9 });
    expect(groupProgress(conSexo("F"), "interrogation")).toEqual({ done: 0, total: 10 });
  });
});
