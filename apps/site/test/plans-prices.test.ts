import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import type { PlanPrices } from "../src/config/prices";
import { getMessages } from "../src/i18n";
import Plans from "../src/sections/Plans.astro";

// F11-SITE-PLANS-04 — el día que se prendan los precios. El sitio construido
// los tiene apagados, así que aquí se renderiza la sección SUELTA con precios
// de mentira: es el ensayo de que prender México es cambiar un `false` por un
// `true`, no rediseñar la tarjeta.

const MX: PlanPrices = {
  basic: { monthly: 199, yearly: 1990 },
  pro: { monthly: 349, yearly: 3490 },
  plus: { monthly: 499, yearly: 4990 },
};
const CA: PlanPrices = {
  basic: { monthly: 29, yearly: 290 },
  pro: { monthly: 49, yearly: 490 },
  plus: { monthly: 89, yearly: 890 },
};
// `\s` incluye los espacios de no separación que usa el francés.
const plain = (html: string) => html.replace(/\s/g, " ");

describe("la sección de planes con los precios prendidos", () => {
  it("cada tarjeta enseña su precio mensual y anual, redondos", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Plans, { props: { route: "es-mx", prices: MX } });
    for (const amount of ["$199", "$1,990", "$349", "$3,490", "$499", "$4,990"]) {
      expect(html).toContain(`<b`);
      expect(html).toContain(`>${amount}</b>`);
    }
    expect(html).not.toContain("$199.00");
    expect([...html.matchAll(/data-price/g)]).toHaveLength(3);
  });

  it("trae el selector mensual/anual y la leyenda de los diez meses", async () => {
    const { prices } = getMessages("es-mx").plans;
    const container = await AstroContainer.create();
    const html = await container.renderToString(Plans, { props: { route: "es-mx", prices: MX } });
    expect(html).toContain("data-billing-cycle");
    expect(html).toMatch(/<input[^>]*value="monthly"[^>]*checked/);
    expect(html).toContain(prices.yearlyDeal);
  });

  it("dice PARA QUIÉN son los precios, con salida para quien está en otro país", async () => {
    // La versión mexicana es también la de quien llega de un país sin mercado
    // propio, pero el cobro a ese visitante le aplica el precio de Estados
    // Unidos. Sin esta línea, un colombiano ve pesos y paga dólares.
    const { prices } = getMessages("es-mx").plans;
    const container = await AstroContainer.create();
    const html = await container.renderToString(Plans, { props: { route: "es-mx", prices: MX } });
    expect(html).toContain(prices.pricesFor.mx);
    expect(html).toMatch(new RegExp(`<a[^>]*href="#footer-market"[^>]*>${prices.otherCountry}`));
    expect(html).toContain(prices.paidByTransfer.replace("{currency}", "MXN"));
  });

  it("el francés escribe el signo al final: lo formatea Intl, no una plantilla", async () => {
    const container = await AstroContainer.create();
    const html = plain(
      await container.renderToString(Plans, { props: { route: "fr-ca", prices: CA } }),
    );
    expect(html).toContain(">29 $</b>");
    expect(html).toContain(">890 $</b>");
  });

  it("apagados, la misma sección no escribe nada de esto", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Plans, { props: { route: "es-mx", prices: null } });
    expect(html).not.toContain("data-price");
    expect(html).not.toContain("data-billing-cycle");
    expect(html).not.toContain("MXN");
  });
});
