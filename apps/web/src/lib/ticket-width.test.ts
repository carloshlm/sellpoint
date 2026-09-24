import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTicketWidthPreference, setTicketWidthPreference } from "./ticket-width";

/**
 * F10-MANFIX-03 — el ancho de papel es de la COMPUTADORA, no de la cuenta:
 * vive en `localStorage`, con el mismo criterio de `sellpoint.locale` y
 * `sellpoint.quickCatalog` (Carlos, 2026-09-24). El valor de ENTRADA es
 * 58 mm: es lo que se imprime hoy, y un ticket de 80 en una impresora de 58
 * se corta; uno de 58 en una de 80 sale angosto pero se lee.
 */
describe("ticket-width (F10-MANFIX-03)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sin nada guardado, el valor de entrada es 58mm", () => {
    expect(getTicketWidthPreference()).toBe("58mm");
  });

  it("guarda la elección y la vuelve a leer", () => {
    setTicketWidthPreference("80mm");

    expect(getTicketWidthPreference()).toBe("80mm");
    expect(localStorage.getItem("sellpoint.ticketWidth")).toBe("80mm");
  });

  it("un valor guardado que no es 58mm ni 80mm cae al de entrada", () => {
    localStorage.setItem("sellpoint.ticketWidth", "papel-carta");

    expect(getTicketWidthPreference()).toBe("58mm");
  });

  describe("ventana privada o almacenamiento bloqueado", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("si leer revienta, cae al valor de entrada sin propagar el error", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      expect(getTicketWidthPreference()).toBe("58mm");
    });

    it("si guardar revienta, no propaga el error", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      expect(() => setTicketWidthPreference("80mm")).not.toThrow();
    });
  });
});
