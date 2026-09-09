import { describe, expect, it } from "vitest";
import { icd10CodeFromDgisKey, icd10CodePrefix, normalizeSearchText } from "./icd10";

/** F9-CLINIC-HC-22 — la clave compacta de la DGIS, el código con punto y la búsqueda sin acentos. */
describe("icd10", () => {
  it("normaliza para buscar: sin acentos, minúsculas, espacios colapsados", () => {
    expect(normalizeSearchText("  INFECCIÓN  AGUDA DE  ")).toBe("infeccion aguda de");
    expect(normalizeSearchText("Ñandú")).toBe("nandu");
  });

  it("la clave de la DGIS se vuelve código con punto; la X es la categoría", () => {
    expect(icd10CodeFromDgisKey("J069")).toBe("J06.9");
    expect(icd10CodeFromDgisKey("A33X")).toBe("A33");
    expect(icd10CodeFromDgisKey("A00")).toBe("A00");
    expect(icd10CodeFromDgisKey("9999")).toBeNull();
    expect(icd10CodeFromDgisKey("j069")).toBe("J06.9");
  });

  it("lo tecleado como código se vuelve prefijo con punto; el texto libre no", () => {
    expect(icd10CodePrefix("j069")).toBe("J06.9");
    expect(icd10CodePrefix("J06.9")).toBe("J06.9");
    expect(icd10CodePrefix("j06")).toBe("J06");
    expect(icd10CodePrefix("j")).toBe("J");
    expect(icd10CodePrefix("e11.")).toBe("E11");
    expect(icd10CodePrefix("faringitis")).toBeNull();
    expect(icd10CodePrefix("j06x")).toBeNull();
  });
});
