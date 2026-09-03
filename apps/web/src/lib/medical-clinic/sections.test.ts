import { MEDICAL_RECORD_SECTIONS } from "@sellpoint/shared";
import en from "@/i18n/en/medicalClinic.json";
import es from "@/i18n/es/medicalClinic.json";
import { expediente } from "@/test/medical-clinic-fixture";
import {
  FUNCTIONAL_SECTION_KEYS,
  groupProgress,
  groupStatus,
  RECORD_CARDS,
  RECORD_GROUPS,
  sectionStatus,
} from "./sections";

/**
 * F9-CLINIC-WEB-09 — el catálogo de tarjetas del tablero y el estado
 * derivado. Las 32 secciones vienen de shared; las 4 de órdenes son de esta
 * pantalla. «En progreso» vive en el GRUPO: una tarjeta o está capturada o
 * no.
 */
describe("catálogo de tarjetas de la historia clínica", () => {
  it("cinco grupos en el orden de Carlos, 36 tarjetas, las 32 secciones primero en su orden", () => {
    expect(RECORD_GROUPS).toEqual([
      "interrogation",
      "examination",
      "assessment_plan",
      "orders",
      "documents",
    ]);
    expect(RECORD_CARDS).toHaveLength(36);
    const secciones = RECORD_CARDS.filter((c) => c.kind === "section").map((c) => c.key);
    expect(secciones).toEqual(MEDICAL_RECORD_SECTIONS.map((s) => s.key));
    expect(RECORD_CARDS.filter((c) => c.group === "orders").map((c) => c.key)).toEqual([
      "prescription",
      "lab_order",
      "diagnostic_order",
      "orders_list",
    ]);
    expect(FUNCTIONAL_SECTION_KEYS).toEqual(["general_data", "chief_complaint", "current_illness"]);
  });

  it("toda tarjeta tiene título en es y en en", () => {
    for (const card of RECORD_CARDS) {
      expect((es.sections as Record<string, { title: string }>)[card.key]?.title).toBeTruthy();
      expect((en.sections as Record<string, { title: string }>)[card.key]?.title).toBeTruthy();
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
      total: 3,
    });
    expect(
      groupStatus(
        expediente(
          {},
          {
            general_data: { sex: "F" },
            chief_complaint: { complaint: "x" },
            current_illness: { narrative: "y" },
          },
        ),
        "interrogation",
      ),
    ).toBe("completed");
    // Un grupo sin secciones funcionales todavía no puede estar «en progreso».
    expect(groupStatus(expediente(), "examination")).toBe("pending");
  });
});
