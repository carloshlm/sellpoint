import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLAN_LIMITS, PLAN_LINES, PUBLISHED_PLANS, planStepLines } from "@sellpoint/shared";
import { describe, expect, it } from "vitest";
import { ANCHORS } from "../src/config/links";
import { getLocale, MARKETS, ROUTES, type Route } from "../src/config/markets";
import { getMessages, LOCALE_MESSAGES } from "../src/i18n";
import { readDist } from "./dist";

// F11-SITE-PLANS-02 a 04 — la sección de planes, leída del sitio construido.

const pageOf = (route: Route) => readDist(`${route}/index.html`);
const escaped = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
function plansOf(route: Route): string {
  const html = pageOf(route);
  const start = html.search(new RegExp(`<section\\b[^>]*\\bid="${ANCHORS.plans}"`));
  expect(start, "no existe la sección de planes").toBeGreaterThan(0);
  return html.slice(start, html.indexOf("</section>", start));
}
/** El bloque de una tarjeta. */
function cardOf(section: string, plan: string): string {
  const start = section.indexOf(`data-plan="${plan}"`);
  expect(start, `no existe la tarjeta ${plan}`).toBeGreaterThan(0);
  return section.slice(start, section.indexOf("</article>", start));
}

describe("tarjetas de plan (PLANS-02)", () => {
  it.each([...ROUTES])(
    "/%s/ publica Basic, Pro y Plus, en ese orden y entre giros y preguntas",
    (route) => {
      const html = pageOf(route);
      const section = plansOf(route);
      const cards = [...section.matchAll(/<article\b[^>]*data-plan="(\w+)"/g)].map((m) => m[1]);
      expect(cards).toEqual([...PUBLISHED_PLANS]);
      const at = (id: string) => html.search(new RegExp(`<section\\b[^>]*\\bid="${id}"`));
      expect(at("who-for")).toBeLessThan(at(ANCHORS.plans));
      expect(at(ANCHORS.plans)).toBeLessThan(at(ANCHORS.faq));
    },
  );

  it.each([...ROUTES])(
    "/%s/: cada tarjeta dice sus usuarios, sus sucursales y SOLO lo que su escalón agrega",
    (route) => {
      const { plans } = getMessages(route);
      const section = plansOf(route);
      for (const plan of PUBLISHED_PLANS) {
        const card = cardOf(section, plan);
        const { users, warehouses } = PLAN_LIMITS[plan];
        expect(card).toContain(escaped(plans.users.replace("{count}", String(users))));
        const warehouseText = warehouses === 1 ? plans.warehouseOne : plans.warehouseMany;
        expect(card).toContain(escaped(warehouseText.replace("{count}", String(warehouses))));
        const listed = [...card.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
          (m[1] as string).replace(/<[^>]+>/g, "").trim(),
        );
        expect(listed).toEqual(planStepLines(plan).map((line) => escaped(plans.lines[line.key])));
      }
      // En escalera: Pro y Plus dicen de quién heredan en vez de repetir la lista.
      expect(cardOf(section, "pro")).toContain(escaped(plans.cards.pro.includes));
      expect(cardOf(section, "plus")).toContain(escaped(plans.cards.plus.includes));
    },
  );

  it.each([...ROUTES])(
    "/%s/: Pro es el «Recomendado» y el único con el botón amarillo",
    (route) => {
      const { plans } = getMessages(route);
      const section = plansOf(route);
      expect(cardOf(section, "pro")).toContain(escaped(plans.recommended));
      expect(cardOf(section, "basic")).not.toContain(escaped(plans.recommended));
      expect(cardOf(section, "pro")).toContain("btn--dot");
      expect(cardOf(section, "basic")).not.toContain("btn--dot");
      expect(cardOf(section, "plus")).not.toContain("btn--dot");
    },
  );

  it.each([...ROUTES])("/%s/: cada botón abre el formulario con SU plan ya elegido", (route) => {
    const section = plansOf(route);
    for (const plan of PUBLISHED_PLANS) {
      expect(cardOf(section, plan)).toContain(`href="?plan=${plan}#${ANCHORS.contact}"`);
    }
    // La franja de Premium: «Algo a la medida».
    expect(section).toContain(`href="?plan=custom#${ANCHORS.contact}"`);
  });

  it.each([...ROUTES])("/%s/: Basic dice a la vista que NO lleva existencias", (route) => {
    expect(plansOf(route)).toContain(escaped(getMessages(route).plans.cards.basic.note));
  });

  it("solo el francés avisa que la aplicación todavía no está en francés (§8.4)", () => {
    expect(plansOf("fr-ca")).toContain("Le français sera bientôt disponible");
    expect(plansOf("en-ca")).not.toContain(escaped(LOCALE_MESSAGES.fr.plans.appLanguageNote));
  });

  it("el soporte NO se promete en ningún idioma: todavía no existe (CONTENIDO §5)", () => {
    for (const route of ROUTES) expect(plansOf(route)).not.toMatch(/soporte|support|assistance/i);
  });
});

describe("tabla comparativa (PLANS-03)", () => {
  it.each([...ROUTES])("/%s/ va plegada, con las 17 líneas y marcas que se LEEN", (route) => {
    const { plans } = getMessages(route);
    const section = plansOf(route);
    const details =
      section.match(/<details\b[^>]*data-plans-compare[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(details).toContain(escaped(plans.compare.toggle));
    expect(details).not.toMatch(/<details\b[^>]*\bopen\b/);
    const rows = [...details.matchAll(/<tr\b[^>]*data-line="([\w]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(PLAN_LINES.map((line) => line.key));
    // Una marca que es solo un color o un ✓ no le dice nada a un lector de pantalla.
    expect(details).toContain(escaped(plans.compare.included));
    expect(details).toContain(escaped(plans.compare.notIncluded));
    // Encabezados de columna y de fila, para que la tabla se pueda recorrer.
    expect(details).toMatch(/<th\b[^>]*scope="col"/);
    expect(details).toMatch(/<th\b[^>]*scope="row"/);
  });

  it("las líneas se llaman IGUAL que en la aplicación, en español y en inglés", () => {
    // El sitio y el sistema tienen que decir lo mismo (CONTENIDO §7.1). Las
    // dos de módulo («Gastos», «Compras») salen del menú de la aplicación.
    for (const language of ["es", "en"] as const) {
      const file = fileURLToPath(
        new URL(`../../web/src/i18n/${language}/common.json`, import.meta.url),
      );
      const app = JSON.parse(readFileSync(file, "utf8")).billing.capabilities as Record<
        string,
        string
      >;
      const site = LOCALE_MESSAGES[language].plans.lines as Record<string, string>;
      for (const [key, name] of Object.entries(app))
        expect(site[key], `${language}:${key}`).toBe(name);
    }
  });
});

describe("el interruptor de precios (PLANS-04)", () => {
  it("hoy está apagado en los tres mercados", () => {
    for (const market of Object.values(MARKETS)) expect(market.showPrices).toBe(false);
  });

  it.each([...ROUTES])(
    "/%s/: apagado, el precio NO viaja en el HTML — ni escondido con CSS",
    (route) => {
      const { plans } = getMessages(route);
      const section = plansOf(route);
      expect(section).not.toContain("data-price");
      expect(section).not.toContain("data-billing-cycle");
      expect(section).not.toContain(escaped(plans.prices.yearlyDeal));
      expect(section).not.toContain(escaped(plans.prices.perMonth));
      const { currency } = MARKETS[getLocale(route).market];
      expect(section).not.toContain(currency);
    },
  );
});
