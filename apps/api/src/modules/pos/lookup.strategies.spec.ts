import {
  LOOKUP_STRATEGIES,
  pareceCodigoDeBarras,
  pareceFolioDeCotizacion,
  pareceSku,
} from "./lookup.strategies";

/**
 * F4-CART-01 — el RECONOCIMIENTO del texto, sin base de datos.
 *
 * Estas funciones son las que deciden qué strategy corre, y son puras
 * justamente para poder fijarlas acá: el resto de la cadena necesita Postgres,
 * pero "¿esto es un código de barras?" no.
 *
 * Lo que se protege no es el regex sino la CONSECUENCIA: `SkuLookup` y
 * `BarcodeLookup` son exclusivas, así que un reconocedor demasiado goloso
 * cortaría la búsqueda difusa que sí habría encontrado lo que el cajero busca.
 */
describe("Reconocedores del buscador (F4-CART-01)", () => {
  describe("pareceFolioDeCotizacion", () => {
    it("reconoce el folio con y sin mayúsculas, y con espacios alrededor", () => {
      expect(pareceFolioDeCotizacion("COT-000001")).toBe(true);
      expect(pareceFolioDeCotizacion("cot-000042")).toBe(true);
      expect(pareceFolioDeCotizacion("  COT-000001  ")).toBe(true);
    });

    it("no confunde las OTRAS series con una cotización", () => {
      // Las cinco series comparten formato: si el reconocedor mirara solo el
      // guion y los dígitos, teclear una entrada abriría una cotización.
      expect(pareceFolioDeCotizacion("ENT-000001")).toBe(false);
      expect(pareceFolioDeCotizacion("VTA-000001")).toBe(false);
      expect(pareceFolioDeCotizacion("SAL-000001")).toBe(false);
    });

    it("no reconoce un folio a medio escribir", () => {
      expect(pareceFolioDeCotizacion("COT-")).toBe(false);
      expect(pareceFolioDeCotizacion("COT")).toBe(false);
    });
  });

  describe("pareceCodigoDeBarras", () => {
    it("reconoce EAN-8, UPC-A y EAN-13", () => {
      expect(pareceCodigoDeBarras("12345678")).toBe(true);
      expect(pareceCodigoDeBarras("012345678905")).toBe(true);
      expect(pareceCodigoDeBarras("7501234567890")).toBe(true);
    });

    it("NO dispara con lo que el cajero está a medio teclear", () => {
      // Sin el largo mínimo, cada pulsación de un número lanzaría una búsqueda
      // exacta y exclusiva que corta la difusa.
      expect(pareceCodigoDeBarras("1")).toBe(false);
      expect(pareceCodigoDeBarras("12345")).toBe(false);
    });

    it("deja pasar los SKU alfanuméricos a su propia strategy", () => {
      expect(pareceCodigoDeBarras("KY6-2026")).toBe(false);
      expect(pareceCodigoDeBarras("ABC123456")).toBe(false);
    });
  });

  describe("pareceSku", () => {
    it("reconoce un código sin espacios", () => {
      expect(pareceSku("KY6")).toBe(true);
      expect(pareceSku("sku-001")).toBe(true);
    });

    it("una FRASE no es un SKU", () => {
      // Es lo que impide que "agua mineral" se resuelva como búsqueda exacta
      // fallida y corte la difusa que sí encuentra el producto.
      expect(pareceSku("agua mineral")).toBe(false);
    });

    it("una sola letra no alcanza", () => {
      expect(pareceSku("a")).toBe(false);
    });
  });

  describe("el orden de la cadena", () => {
    it("pone las exclusivas antes que las difusas", () => {
      const exclusivas = LOOKUP_STRATEGIES.map((s) => s.exclusive);
      const primeraDifusa = exclusivas.indexOf(false);
      // Ninguna exclusiva puede quedar DESPUÉS de una difusa: la cadena corta
      // en la primera exclusiva que acierta, y una difusa antes ya habría
      // devuelto su lista.
      expect(exclusivas.slice(primeraDifusa)).not.toContain(true);
    });

    it("resuelve el folio de cotización antes que el SKU", () => {
      // `COT-000001` cumple `pareceSku` (no tiene espacios). Si `SkuLookup`
      // corriera primero, el folio se buscaría como código de producto.
      const orden = LOOKUP_STRATEGIES.map((s) => s.kind);
      expect(orden.indexOf("quote")).toBeLessThan(orden.indexOf("sku"));
    });

    it("resuelve el código de barras antes que el SKU", () => {
      // Un código de barras es todo dígitos y también cumple `pareceSku`.
      const orden = LOOKUP_STRATEGIES.map((s) => s.kind);
      expect(orden.indexOf("barcode")).toBeLessThan(orden.indexOf("sku"));
    });
  });
});
