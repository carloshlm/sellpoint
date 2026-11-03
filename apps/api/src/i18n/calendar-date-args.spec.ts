import { formatCalendarDate, formatCalendarDateArgs } from "./calendar-date-args";

/**
 * Carlos (2026-11-02): los mensajes de caducidad decían «2027-10-01». Se
 * leen como en la pantalla: el día primero en español, el mes primero en
 * inglés, y el año siempre con sus cuatro cifras.
 */
describe("las fechas de calendario de un mensaje", () => {
  it("salen con el formato del idioma de quien lee", () => {
    expect(formatCalendarDate("2027-10-01", "es")).toBe("01/10/2027");
    expect(formatCalendarDate("2027-10-01", "en")).toBe("10/01/2027");
  });

  it("conservan las cuatro cifras de un año mal escrito: «0027» no se lee como 2027", () => {
    expect(formatCalendarDate("0027-10-01", "es")).toBe("01/10/0027");
  });

  it("cambian solo la caducidad y dejan intacto lo demás", () => {
    expect(
      formatCalendarDateArgs({ expiresAt: "2027-10-01", line: 2, lotCode: "2027-10-01" }, "es"),
    ).toEqual({ expiresAt: "01/10/2027", line: 2, lotCode: "2027-10-01" });
  });

  it("lo que no es una fecha de calendario pasa tal cual", () => {
    expect(formatCalendarDateArgs({ expiresAt: "" }, "es")).toEqual({ expiresAt: "" });
    expect(formatCalendarDateArgs({ expiresAt: "2027-13-45" }, "es")).toEqual({
      expiresAt: "2027-13-45",
    });
    expect(formatCalendarDateArgs(undefined, "es")).toBeUndefined();
  });
});
