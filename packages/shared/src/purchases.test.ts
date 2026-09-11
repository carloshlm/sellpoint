import { describe, expect, it } from "vitest";
import {
  PURCHASE_STATUSES,
  PURCHASE_TAX_MODES,
  purchaseStatusSchema,
  totalMismatch,
} from "./purchases";

/** F9-PURCH-01 — los contratos de Compras y el descuadre DERIVADO del papel. */
describe("contratos de Compras (F9-PURCH-01)", () => {
  it("los tres estados y el modo fiscal por documento (el default lo pone el negocio, F9-COSTMODE-04)", () => {
    expect(PURCHASE_STATUSES).toEqual(["draft", "confirmed", "canceled"]);
    expect(PURCHASE_TAX_MODES).toEqual(["included", "excluded"]);
    expect(purchaseStatusSchema.parse("confirmed")).toBe("confirmed");
    expect(() => purchaseStatusSchema.parse("open")).toThrow();
  });

  describe("totalMismatch", () => {
    it("sin total declarado no hay descuadre", () => {
      expect(totalMismatch(null, "1160.00")).toEqual({ mismatch: false, difference: null });
      expect(totalMismatch(undefined, "1160.00")).toEqual({ mismatch: false, difference: null });
      expect(totalMismatch("  ", "1160.00")).toEqual({ mismatch: false, difference: null });
    });

    it("lo mismo capturado que lo declarado no descuadra", () => {
      expect(totalMismatch("100.00", "100.00")).toEqual({ mismatch: false, difference: null });
    });

    it("un centavo de diferencia SÍ descuadra, con su signo", () => {
      expect(totalMismatch("100.00", "99.99")).toEqual({ mismatch: true, difference: "0.01" });
      // El papel dice MENOS que lo capturado: la diferencia va negativa.
      expect(totalMismatch("99.99", "100.00")).toEqual({ mismatch: true, difference: "-0.01" });
    });

    it("la comparación es decimal: «100.10» y «100.1» son el MISMO importe", () => {
      expect(totalMismatch("100.10", "100.1")).toEqual({ mismatch: false, difference: null });
      expect(totalMismatch("100", "100.00")).toEqual({ mismatch: false, difference: null });
    });

    it("sin punto flotante: 0.1 + 0.2 no inventa un descuadre de un centavo", () => {
      expect(totalMismatch("1160.30", "1160.30")).toEqual({ mismatch: false, difference: null });
      expect(totalMismatch("0.30", "0.30")).toEqual({ mismatch: false, difference: null });
    });

    it("un declarado que no es un número se trata como si no hubiera papel", () => {
      expect(totalMismatch("mil pesos", "100.00")).toEqual({ mismatch: false, difference: null });
    });
  });
});
