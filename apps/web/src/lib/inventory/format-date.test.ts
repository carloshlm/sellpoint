import { formatBusinessTime, formatCalendarDate } from "./format-date";

/**
 * F3-EXIT-02 — una caducidad es una fecha de CALENDARIO, no un instante.
 *
 * El bug que motivó esto: `new Date("2026-07-01")` es medianoche UTC, y
 * formatearla con el huso local la corre un día hacia atrás en toda América.
 * Un lote que vence el **1 de julio** se mostraba como **30/6** en CDMX.
 *
 * No es cosmético: es el número por el que alguien decide tirar mercancía
 * buena o vender una vencida.
 */
describe("formatCalendarDate (F3-EXIT-02)", () => {
  const ISO = "2026-07-01T00:00:00.000Z";

  it("muestra el día tal como se guardó, con dos dígitos y año completo", () => {
    expect(formatCalendarDate(ISO, "es")).toBe("01/07/2026");
  });

  /**
   * El corazón del asunto: da lo MISMO desde cualquier huso. Si esto se
   * rompiera, el mismo lote diría dos fechas distintas según quién lo mire.
   */
  it("no se corre un día en husos detrás de UTC", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Mexico_City";
      expect(formatCalendarDate(ISO, "es")).toBe("01/07/2026");
      process.env.TZ = "Pacific/Kiritimati";
      expect(formatCalendarDate(ISO, "es")).toBe("01/07/2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("el orden lo decide el idioma: en inglés el mes va primero", () => {
    expect(formatCalendarDate(ISO, "en")).toBe("07/01/2026");
  });

  /** Sin caducidad no se llama a esta función, pero el 29/02 sí existe. */
  it("un año bisiesto no se corre", () => {
    expect(formatCalendarDate("2028-02-29T00:00:00.000Z", "es")).toBe("29/02/2028");
  });
});

/**
 * F10-MANFIX-16 — la HORA de un instante, con el formato de hora de toda la
 * app: `timeStyle: "short"` en el idioma de la interfaz. La barra del punto de
 * venta decía «08:45» y el panel del vendedor «08:45 a.m.» para la misma
 * apertura de turno.
 */
describe("formatBusinessTime (F10-MANFIX-16)", () => {
  // 14:45 UTC son las 8:45 en la Ciudad de México (UTC-6 todo el año).
  const ISO = "2026-09-24T14:45:00.000Z";

  it("en español, «8:45»: sin cero a la izquierda ni «a.m.»", () => {
    expect(formatBusinessTime(ISO, "es", "America/Mexico_City")).toBe("8:45");
  });

  it("en inglés, «8:45 AM»", () => {
    expect(formatBusinessTime(ISO, "en", "America/Mexico_City")).toMatch(/^8:45\sAM$/);
  });

  /** El reloj es el del NEGOCIO, como el reporte de cierres de turno. */
  it("da la hora del negocio desde cualquier huso", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      expect(formatBusinessTime(ISO, "es", "America/Mexico_City")).toBe("8:45");
    } finally {
      process.env.TZ = original;
    }
  });

  /** Una zona inválida no revienta la barra del turno: cae a la del navegador. */
  it("con una zona inválida, cae a la del navegador en vez de reventar", () => {
    expect(formatBusinessTime(ISO, "es", "Marte/Olympus")).toBe(
      formatBusinessTime(ISO, "es", undefined),
    );
  });
});
