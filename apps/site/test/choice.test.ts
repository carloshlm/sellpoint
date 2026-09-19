import { describe, expect, it } from "vitest";
import { currentSection, decideNotice, readChoice, saveChoice } from "../src/geo/choice";

// F11-SITE-GEO-02 y GEO-04 — la lógica del aviso y de la elección recordada,
// sin navegador: lo que el guion de la página hace es llamar a estas funciones.

/** Un almacenamiento de mentira, como el de `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

/** El almacenamiento de un modo privado o con los datos bloqueados: todo truena. */
const brokenStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("la elección recordada", () => {
  it("se guarda y se lee", () => {
    const storage = memoryStorage();
    saveChoice(storage, "fr-ca");
    expect(readChoice(storage)).toBe("fr-ca");
  });

  it("una elección que no es una ruta de la matriz se ignora", () => {
    // Una ruta vieja (un mercado que se quitó) o un valor manoseado no pueden
    // mandar a nadie a una página que no existe.
    expect(readChoice(memoryStorage({ route: "pt-br" }))).toBeNull();
    expect(readChoice(memoryStorage({ route: "" }))).toBeNull();
  });

  it("sin almacenamiento, o si truena, el sitio sigue funcionando", () => {
    expect(readChoice(null)).toBeNull();
    expect(readChoice(brokenStorage)).toBeNull();
    expect(() => saveChoice(null, "en-us")).not.toThrow();
    expect(() => saveChoice(brokenStorage, "en-us")).not.toThrow();
  });
});

describe("el aviso de la raíz", () => {
  it("aparece cuando la sugerencia es otro mercado", () => {
    expect(decideNotice({ current: "es-mx", saved: null, suggested: "en-ca" })).toBe("en-ca");
  });

  it("no aparece cuando la sugerencia es la página que ya se ve", () => {
    expect(decideNotice({ current: "es-mx", saved: null, suggested: "es-mx" })).toBeNull();
  });

  it("la elección guardada manda sobre la sugerencia", () => {
    // Quien eligió México no vuelve a ver «¿Estás en Canadá?», aunque su zona
    // horaria lo diga (va de viaje, usa una VPN).
    expect(decideNotice({ current: "es-mx", saved: "es-mx", suggested: "en-ca" })).toBeNull();
    // Y quien eligió Canadá y vuelve por la raíz ve SU versión, no la sugerida.
    expect(decideNotice({ current: "es-mx", saved: "fr-ca", suggested: "en-us" })).toBe("fr-ca");
  });
});

describe("cambiar de idioma lleva a la misma sección", () => {
  const sections = [
    { id: "what-it-does", top: -900 },
    { id: "benefits", top: -40 },
    { id: "plans", top: 600 },
  ];

  it("la sección en curso es la última que ya cruzó la línea de lectura", () => {
    expect(currentSection(sections, 250)).toBe("benefits");
  });

  it("arriba de todo no hay sección: se abre la otra versión desde el principio", () => {
    expect(currentSection([{ id: "what-it-does", top: 700 }], 250)).toBeNull();
    expect(currentSection([], 250)).toBeNull();
  });
});
