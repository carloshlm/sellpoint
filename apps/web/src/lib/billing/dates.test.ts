import { formatDeadline, formatInstant } from "./dates";

/**
 * Carlos vio el banner en producción (2026-08-29) y decía «venció el
 * 8/27/2026»: formato estadounidense y un día corrido. El vencimiento real
 * era el 26 de agosto — el instante guardado (27-ago 06:00 UTC) es el
 * arranque del día siguiente al último día hábil.
 */
describe("fechas del cobro en la zona del negocio", () => {
  const CDMX = "America/Mexico_City";
  // 27-ago 06:00 UTC = arranque del 27 en CDMX ⇒ el último día hábil es el 26.
  const VENCIMIENTO = "2026-08-27T06:00:00.000Z";

  describe("formatDeadline (límites abiertos)", () => {
    it("un vencimiento muestra el ÚLTIMO DÍA HÁBIL, no el instante crudo", () => {
      expect(formatDeadline(VENCIMIENTO, CDMX, "es")).toBe("26/8/2026");
    });

    it("respeta el locale de la app, no el del navegador", () => {
      expect(formatDeadline(VENCIMIENTO, CDMX, "en")).toBe("8/26/2026");
    });

    /**
     * El mismo instante, otro negocio: la fecha de cobro pertenece al
     * NEGOCIO. Un dueño que viaja no cambia su día de pago.
     */
    it("la zona del negocio manda sobre cualquier otra", () => {
      // En Madrid (UTC+2 en agosto) ese instante ya es el 27 a las 08:00.
      expect(formatDeadline(VENCIMIENTO, "Europe/Madrid", "es")).toBe("27/8/2026");
      expect(formatDeadline(VENCIMIENTO, CDMX, "es")).toBe("26/8/2026");
    });

    it("sin fecha responde una raya, no `Invalid Date`", () => {
      expect(formatDeadline(null, CDMX, "es")).toBe("—");
      expect(formatDeadline("no es una fecha", CDMX, "es")).toBe("—");
    });
  });

  describe("formatInstant (hechos puntuales)", () => {
    it("un pago se muestra en el día del negocio, sin restarle nada", () => {
      // 28-ago 02:00 UTC son todavía las 20:00 del 27 en CDMX.
      expect(formatInstant("2026-08-28T02:00:00.000Z", CDMX, "es")).toBe("27/8/2026");
    });

    it("sin fecha, una raya", () => {
      expect(formatInstant(null, CDMX, "es")).toBe("—");
    });
  });
});
