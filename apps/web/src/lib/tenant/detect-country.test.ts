import { describe, expect, it } from "vitest";
import { countryFromSignals } from "./detect-country";

/**
 * Carlos (2026-10-31): el wizard preselecciona el país de quien se registra.
 * Se deduce de la zona horaria del navegador (sin servicios externos ni datos
 * que salgan de la computadora) y, si la zona no lo dice, de la región del
 * idioma. Sin pistas, no se adivina: la persona elige.
 */
describe("countryFromSignals", () => {
  it.each([
    ["America/Mexico_City", "MX"],
    ["America/Toronto", "CA"],
    ["America/New_York", "US"],
    ["Europe/Madrid", "ES"],
  ])("la zona %s dice %s", (zona, pais) => {
    expect(countryFromSignals(zona, [])).toBe(pais);
  });

  it("reconoce el nombre viejo que da Chrome (Asia/Calcutta es Asia/Kolkata)", () => {
    expect(countryFromSignals("Asia/Calcutta", [])).toBe("IN");
  });

  it("la zona manda sobre el idioma: un navegador en inglés en Toronto es Canadá", () => {
    expect(countryFromSignals("America/Toronto", ["en-US"])).toBe("CA");
  });

  it("si la zona no dice nada, usa la región del idioma", () => {
    expect(countryFromSignals("Etc/UTC", ["es-MX", "en-US"])).toBe("MX");
  });

  it("sin zona útil ni idioma con región, no adivina", () => {
    expect(countryFromSignals("Etc/UTC", ["es", "en"])).toBe("");
    expect(countryFromSignals("", ["xx-ZZ"])).toBe("");
  });
});
