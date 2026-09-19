import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTE,
  formatMoney,
  getLocale,
  LOCALES,
  localesOf,
  MARKETS,
  ROUTES,
  showPrices,
} from "../src/config/markets";

// F11-SITE-BASE-04 — la matriz de SITIO-WEB-CONTENIDO.md §6, como archivo tipado.
describe("matriz de mercados", () => {
  it("son las cinco rutas aprobadas, y México es la de quien llega sin país", () => {
    expect([...ROUTES].sort()).toEqual(["en-ca", "en-us", "es-mx", "es-us", "fr-ca"]);
    expect(DEFAULT_ROUTE).toBe("es-mx");
  });

  it("cada mercado tiene exactamente un idioma por omisión", () => {
    for (const market of Object.keys(MARKETS) as (keyof typeof MARKETS)[]) {
      const defaults = localesOf(market).filter((locale) => locale.isMarketDefault);
      expect(defaults, market).toHaveLength(1);
    }
    expect(getLocale("en-us").isMarketDefault).toBe(true);
    expect(getLocale("en-ca").isMarketDefault).toBe(true);
  });

  it("la ruta se arma con el idioma y el país: no hay dos formas de escribirla", () => {
    for (const locale of LOCALES) {
      const country = MARKETS[locale.market].country.toLowerCase();
      expect(locale.route).toBe(`${locale.language}-${country}`);
      expect(locale.htmlLang).toBe(`${locale.language}-${country.toUpperCase()}`);
    }
  });

  it("los precios están apagados en los tres mercados", () => {
    for (const route of ROUTES) expect(showPrices(route), route).toBe(false);
  });

  it("showPrices es del MERCADO: dos rutas del mismo país no pueden discrepar", () => {
    // Un mercado con el precio en un idioma y sin él en el otro no tiene
    // explicación posible. No es un campo de la ruta, y esta prueba lo cuida.
    for (const locale of LOCALES) expect(locale).not.toHaveProperty("showPrices");
    expect(showPrices("en-ca")).toBe(showPrices("fr-ca"));
    expect(showPrices("en-us")).toBe(showPrices("es-us"));
  });

  it("el dinero lo formatea Intl, no una plantilla escrita a mano", () => {
    expect(formatMoney(1250.5, "es-mx")).toBe("$1,250.50");
    expect(formatMoney(1250.5, "en-us")).toBe("$1,250.50");
    expect(formatMoney(1250.5, "en-ca")).toBe("$1,250.50");
    // El francés pone el signo al final y separa con espacios de no separación.
    expect(formatMoney(1250.5, "fr-ca").replace(/[  ]/g, " ")).toBe("1 250,50 $");
  });

  it("una ruta desconocida truena en vez de caer en silencio a otra", () => {
    expect(() => getLocale("pt-br" as never)).toThrow();
  });
});
