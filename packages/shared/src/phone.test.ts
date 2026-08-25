import { describe, expect, it } from "vitest";
import { ISO_COUNTRY_CODES } from "./countries";
import { COUNTRY_DIAL_CODES, isE164, splitE164 } from "./phone";

/**
 * Teléfono del negocio (Carlos, 2026-08-25): la UI compone país + número,
 * pero lo que VIAJA y se GUARDA es un solo string E.164 canónico
 * (`+525512345678`). Este módulo es la fuente compartida de los dial codes
 * y de la forma canónica — mismo criterio que `countries.ts`: un catálogo,
 * dos consumidores (validación del API y selector del web).
 */
describe("COUNTRY_DIAL_CODES", () => {
  it("TODO país del catálogo tiene dial code: un país sin dial rompería el selector", () => {
    for (const code of ISO_COUNTRY_CODES) {
      expect(COUNTRY_DIAL_CODES[code], `falta dial code para ${code}`).toBeDefined();
    }
  });

  it("los dial codes son dígitos sin '+' ni ceros a la izquierda (1 a 4 dígitos, ITU E.164)", () => {
    for (const [country, dial] of Object.entries(COUNTRY_DIAL_CODES)) {
      expect(dial, `dial inválido para ${country}: ${dial}`).toMatch(/^[1-9]\d{0,3}$/);
    }
  });

  it("los mercados conocidos traen su dial real", () => {
    expect(COUNTRY_DIAL_CODES.MX).toBe("52");
    expect(COUNTRY_DIAL_CODES.US).toBe("1");
    expect(COUNTRY_DIAL_CODES.CA).toBe("1");
    expect(COUNTRY_DIAL_CODES.ES).toBe("34");
    expect(COUNTRY_DIAL_CODES.AR).toBe("54");
    expect(COUNTRY_DIAL_CODES.BR).toBe("55");
    expect(COUNTRY_DIAL_CODES.GB).toBe("44");
    expect(COUNTRY_DIAL_CODES.XK).toBe("383");
  });
});

describe("isE164", () => {
  it("acepta la forma canónica: '+' y 8 a 15 dígitos sin separadores", () => {
    expect(isE164("+525512345678")).toBe(true);
    expect(isE164("+15551234567")).toBe(true);
    expect(isE164("+34600123456")).toBe(true);
  });

  it("rechaza lo que NO es canónico: separadores, sin '+', letras, cero inicial, largos", () => {
    expect(isE164("+52 55 1234 5678")).toBe(false);
    expect(isE164("525512345678")).toBe(false);
    expect(isE164("+52ABC5512345")).toBe(false);
    expect(isE164("+05512345678")).toBe(false);
    // 16 dígitos: uno más que el máximo ITU.
    expect(isE164("+5255123456789012")).toBe(false);
    expect(isE164("+5255123")).toBe(false);
  });
});

describe("splitE164", () => {
  it("separa dial y número nacional por el prefijo MÁS LARGO que matchee", () => {
    expect(splitE164("+525512345678")).toEqual({ dialCode: "52", nationalNumber: "5512345678" });
    expect(splitE164("+15551234567")).toEqual({ dialCode: "1", nationalNumber: "5551234567" });
    // 370 (Lituania) le gana a 3 (que no existe como dial) y a 37 (tampoco).
    expect(splitE164("+37060000000")).toEqual({ dialCode: "370", nationalNumber: "60000000" });
    // 7 cubre Rusia y Kazajistán: el dial es el mismo, el país lo decide la UI.
    expect(splitE164("+77121234567")).toEqual({ dialCode: "7", nationalNumber: "7121234567" });
  });

  it("devuelve null ante algo que no es E.164 canónico", () => {
    expect(splitE164("+52 55 1234 5678")).toBeNull();
    expect(splitE164("5512345678")).toBeNull();
    expect(splitE164("")).toBeNull();
  });
});
