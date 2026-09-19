import { describe, expect, it } from "vitest";
import {
  CURRENT_TERMS_VERSION,
  mustAcceptTerms,
  PRIVACY_URL,
  TERMS_URL,
  termsAcceptanceRequired,
} from "./terms";

/**
 * F11-SITE-LEGAL — el interruptor de los textos legales.
 *
 * Nació dormido (`null`) y se ENCENDIÓ el 2026-09-19, el día que los textos
 * se publicaron sin huecos. La versión es una FECHA: es la etiqueta que se
 * guarda junto a cada aceptación, y tiene que poder leerla una persona.
 */
describe("CURRENT_TERMS_VERSION", () => {
  it("está encendida y es una fecha AAAA-MM-DD válida", () => {
    expect(CURRENT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(String(CURRENT_TERMS_VERSION)))).toBe(false);
  });

  it("no va en el futuro: nadie acepta hoy un texto que todavía no existe", () => {
    expect(Date.parse(String(CURRENT_TERMS_VERSION))).toBeLessThanOrEqual(Date.now());
  });
});

describe("termsAcceptanceRequired", () => {
  it("dormido: el registro no exige la casilla", () => {
    expect(termsAcceptanceRequired(null)).toBe(false);
  });

  it("encendido: el registro exige la casilla", () => {
    expect(termsAcceptanceRequired("2026-10-01")).toBe(true);
  });
});

describe("mustAcceptTerms", () => {
  it("dormido: nadie debe aceptar, ni siquiera quien nunca aceptó", () => {
    expect(mustAcceptTerms(null, null)).toBe(false);
    expect(mustAcceptTerms("2026-01-01", null)).toBe(false);
  });

  it("encendido: quien nunca aceptó debe aceptar", () => {
    expect(mustAcceptTerms(null, "2026-10-01")).toBe(true);
    expect(mustAcceptTerms(undefined, "2026-10-01")).toBe(true);
  });

  it("encendido: quien aceptó una versión VIEJA vuelve a aceptar", () => {
    expect(mustAcceptTerms("2026-09-01", "2026-10-01")).toBe(true);
  });

  it("encendido: quien ya aceptó la versión vigente no ve nada", () => {
    expect(mustAcceptTerms("2026-10-01", "2026-10-01")).toBe(false);
  });

  it("sin segundo argumento cae a la constante del paquete (hoy, ENCENDIDA)", () => {
    expect(mustAcceptTerms(null)).toBe(true);
    expect(mustAcceptTerms(CURRENT_TERMS_VERSION)).toBe(false);
  });
});

describe("Los enlaces legales", () => {
  it("apuntan al sitio público, uno por idioma de la aplicación", () => {
    expect(TERMS_URL.es).toBe("https://sellpointy.com/es-mx/terminos/");
    expect(TERMS_URL.en).toBe("https://sellpointy.com/en-us/terms/");
    expect(PRIVACY_URL.es).toBe("https://sellpointy.com/es-mx/privacidad/");
    expect(PRIVACY_URL.en).toBe("https://sellpointy.com/en-us/privacy/");
  });
});
