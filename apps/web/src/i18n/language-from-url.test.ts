import { describe, expect, it } from "vitest";
import { createI18n } from "./index";

/**
 * El idioma que trae el sitio público (Carlos, 2026-09-19): los botones de
 * sellpointy.com llevan `?lang=` con el idioma de la versión que la persona
 * estaba leyendo, para que no aterrice en inglés tras leer todo en español.
 *
 * La aplicación arranca en INGLÉS cuando nadie eligió nada (`INITIAL_LOCALE`,
 * decisión del 2026-08-16) y esa decisión sigue viva: `?lang=` solo pesa
 * cuando viene en la dirección, y por debajo de lo que la persona ya eligió a
 * mano en ESTE navegador.
 */
function detectorOrder(): string[] {
  const options = createI18n({ withDetector: true }).options.detection;
  return [...((options?.order ?? []) as string[])];
}

describe("el idioma que llega en la dirección", () => {
  it("la dirección se mira ANTES que lo guardado y el resto queda fuera", () => {
    expect(detectorOrder()).toEqual(["querystring", "localStorage"]);
  });

  it("el parámetro se llama `lang`, como el que escribe el sitio", () => {
    expect(createI18n({ withDetector: true }).options.detection?.lookupQuerystring).toBe("lang");
  });

  it("lo que llega en la dirección se recuerda: no se pierde al navegar", () => {
    expect(createI18n({ withDetector: true }).options.detection?.caches).toEqual(["localStorage"]);
  });
});
