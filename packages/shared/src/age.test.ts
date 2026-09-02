import { describe, expect, it } from "vitest";
import { ageFromBirthDate } from "./age";

/**
 * F9-RECEP-01 — la edad se CALCULA, nunca se guarda: un entero es correcto
 * el día que se teclea y miente el resto del año. Dos fechas `YYYY-MM-DD`
 * que ya están en el calendario del negocio (la zona la resolvió el llamador
 * con `localCalendarDate`); acá no hay `Date` ni zona.
 */
describe("ageFromBirthDate (F9-RECEP-01)", () => {
  it("el día del cumpleaños ya cumplió", () => {
    expect(ageFromBirthDate("1990-09-02", "2026-09-02")).toBe(36);
  });

  it("un día antes del cumpleaños todavía no", () => {
    expect(ageFromBirthDate("1990-09-03", "2026-09-02")).toBe(35);
  });

  it("nacido el 29 de febrero, evaluado un 28 de febrero de año no bisiesto, no cumple todavía", () => {
    expect(ageFromBirthDate("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageFromBirthDate("2000-02-29", "2026-03-01")).toBe(26);
  });

  it("una fecha futura devuelve 0, nunca negativo", () => {
    expect(ageFromBirthDate("2030-01-01", "2026-09-02")).toBe(0);
  });

  it("un recién nacido tiene 0", () => {
    expect(ageFromBirthDate("2026-09-01", "2026-09-02")).toBe(0);
  });
});
