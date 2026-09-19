import { describe, expect, it } from "vitest";
import { splitEmphasis } from "../src/i18n/emphasis";

// La palabra subrayada de cada beneficio va marcada con *asteriscos* en el
// texto, para que quien traduce decida CUÁL palabra subraya en su idioma.
describe("splitEmphasis", () => {
  it("separa la palabra marcada del resto", () => {
    expect(splitEmphasis("Cobra en *segundos*, no en filas.")).toEqual([
      { text: "Cobra en ", emphasis: false },
      { text: "segundos", emphasis: true },
      { text: ", no en filas.", emphasis: false },
    ]);
  });

  it("sin marca, el texto sale entero", () => {
    expect(splitEmphasis("Sin énfasis")).toEqual([{ text: "Sin énfasis", emphasis: false }]);
  });

  it("la marca puede abrir o cerrar la frase", () => {
    expect(splitEmphasis("*Hoy* no")).toEqual([
      { text: "Hoy", emphasis: true },
      { text: " no", emphasis: false },
    ]);
  });

  it("una marca sin cerrar truena al construir, no llega a la página", () => {
    expect(() => splitEmphasis("Cobra en *segundos")).toThrow();
  });
});
