import { searchPatientsSchema } from "./search-patients.dto";
import { updateSettingsSchema } from "./settings.dto";
import { createStudySchema, listStudiesQuerySchema, updateStudySchema } from "./upsert-study.dto";

describe("DTOs del Consultorio Médico (F9-CLINIC-07/09/22)", () => {
  it("un estudio necesita código y nombre; costo y precio no negativos", () => {
    expect(createStudySchema.safeParse({ code: "BH", name: "Biometría" }).success).toBe(true);
    expect(createStudySchema.parse({ code: " bh ", name: "x" }).code).toBe("BH");
    expect(createStudySchema.safeParse({ code: "", name: "x" }).success).toBe(false);
    expect(createStudySchema.safeParse({ code: "BH", name: "x", price: -1 }).success).toBe(false);
    expect(updateStudySchema.safeParse({}).success).toBe(false);
    expect(updateStudySchema.safeParse({ price: null }).success).toBe(true);
  });

  it("el listado pagina con tope 100 y el filtro de activos es texto", () => {
    expect(listStudiesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(listStudiesQuerySchema.parse({ isActive: "false" }).isActive).toBe(false);
    expect(listStudiesQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it("buscar por turno exige un entero positivo; por nombre, texto", () => {
    expect(searchPatientsSchema.parse({ mode: "turn", q: "12" })).toEqual({
      mode: "turn",
      q: "12",
    });
    expect(searchPatientsSchema.safeParse({ mode: "turn", q: "abc" }).success).toBe(false);
    expect(searchPatientsSchema.safeParse({ mode: "turn", q: "0" }).success).toBe(false);
    expect(searchPatientsSchema.safeParse({ mode: "name", q: "" }).success).toBe(false);
    expect(searchPatientsSchema.safeParse({ mode: "phone", q: "x" }).success).toBe(false);
  });

  it("la configuración pide al menos una casilla", () => {
    expect(updateSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ sellsLabStudies: true }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ sellsLabStudies: "yes" }).success).toBe(false);
  });
});
