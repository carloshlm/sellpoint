import { describe, expect, it } from "vitest";
import {
  customerLabelSchema,
  DEFAULT_RECEPTION_SETTINGS,
  normalizeCustomerLabel,
  pluralizeLabel,
  RECEPTION_MENU_ITEMS,
} from "./reception";

/**
 * F9-RECEP-17 — la configuración de Recepción es código compartido: el API
 * normaliza la palabra con la misma función con la que el web la previsualiza,
 * y los dos derivan el plural igual. Si divergieran, la pantalla prometería
 * una cosa y la base guardaría otra.
 */
describe("la palabra con la que el negocio llama a su cliente (F9-RECEP-17)", () => {
  it("se guarda Capitalizada: primera letra mayúscula, el resto minúscula", () => {
    expect(normalizeCustomerLabel("paciente")).toBe("Paciente");
    expect(normalizeCustomerLabel("PACIENTE")).toBe("Paciente");
    expect(normalizeCustomerLabel("  alumno ")).toBe("Alumno");
    // Con acento inicial también: la mayúscula respeta el idioma.
    expect(normalizeCustomerLabel("árbitro")).toBe("Árbitro");
  });

  it("es UNA palabra sin espacios, de 1 a 40 letras", () => {
    expect(customerLabelSchema.safeParse("Paciente").success).toBe(true);
    expect(customerLabelSchema.safeParse("Paciente nuevo").success).toBe(false);
    expect(customerLabelSchema.safeParse("Pa\tciente").success).toBe(false);
    expect(customerLabelSchema.safeParse("").success).toBe(false);
    expect(customerLabelSchema.safeParse("   ").success).toBe(false);
    expect(customerLabelSchema.safeParse("a".repeat(41)).success).toBe(false);
    expect(customerLabelSchema.safeParse("a".repeat(40)).success).toBe(true);
  });

  it("el plural en español: vocal +s, consonante +es, z → ces", () => {
    expect(pluralizeLabel("Paciente", "es")).toBe("Pacientes");
    expect(pluralizeLabel("Alumno", "es")).toBe("Alumnos");
    expect(pluralizeLabel("Huésped", "es")).toBe("Huéspedes");
    expect(pluralizeLabel("Aprendiz", "es")).toBe("Aprendices");
  });

  it("el plural en inglés: s/x/ch/sh +es, consonante+y → ies, el resto +s", () => {
    expect(pluralizeLabel("Patient", "en")).toBe("Patients");
    expect(pluralizeLabel("Guest", "en")).toBe("Guests");
    expect(pluralizeLabel("Class", "en")).toBe("Classes");
    expect(pluralizeLabel("Family", "en")).toBe("Families");
    expect(pluralizeLabel("Boy", "en")).toBe("Boys");
  });

  it("sin configurar, todo visible y sin palabra propia", () => {
    expect(DEFAULT_RECEPTION_SETTINGS).toEqual({
      customerLabel: null,
      showCustomers: true,
      showTurns: true,
    });
    expect(RECEPTION_MENU_ITEMS).toEqual(["customers", "turns"]);
  });
});
