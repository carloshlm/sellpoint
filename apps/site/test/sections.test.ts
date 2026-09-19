import { describe, expect, it } from "vitest";
import { ANCHORS, APP_LOGIN_URL, APP_REGISTER_URL } from "../src/config/links";
import { formatMoney, getLocale, ROUTES, type Route } from "../src/config/markets";
import { BENEFIT_ORDER, FAQ_ORDER, MOCK_SALE, mockTotal } from "../src/config/page";
import { getMessages } from "../src/i18n";
import { readDist } from "./dist";

// F11-SITE-PAGE — las secciones, leídas del sitio construido.

const pageOf = (route: Route) => readDist(`${route}/index.html`);
/** El texto tal como lo escribe Astro en el CUERPO del HTML (en un atributo no escapa el apóstrofo). */
const escaped = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
/** El marcado de la sección con ese `id` (hasta su cierre). */
function sectionOf(html: string, id: string, tag = "section"): string {
  const start = html.search(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"`));
  expect(start, `no existe <${tag} id="${id}">`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf(`</${tag}>`, start));
}
/** Lo que se LEE de un trozo de marcado: sin etiquetas y con las entidades resueltas. */
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\n]+/g, " ")
    .trim();

describe("navegación (PAGE-01)", () => {
  it.each([...ROUTES])("/%s/ lleva las cuatro anclas, la puerta y el botón", (route) => {
    const { nav } = getMessages(route);
    const html = pageOf(route);
    const navMarkup = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(navMarkup).toContain(`aria-label="${nav.label}"`);
    for (const [anchor, label] of [
      [ANCHORS.whatItDoes, nav.whatItDoes],
      [ANCHORS.benefits, nav.benefits],
      [ANCHORS.plans, nav.plans],
      [ANCHORS.faq, nav.faq],
    ]) {
      expect(navMarkup).toMatch(new RegExp(`href="#${anchor}"[^>]*>\\s*${label}\\s*<`));
    }
    expect(html).toContain(`href="${APP_LOGIN_URL}"`);
    expect(html).toContain(`href="${APP_REGISTER_URL}"`);
  });

  it("máximo cinco entradas en el centro del menú (CONTENIDO §2)", () => {
    const list = pageOf("es-mx").match(/<ul[^>]*class="links[^"]*"[^>]*>([\s\S]*?)<\/ul>/);
    expect(list).not.toBeNull();
    const items = [...(list?.[1] ?? "").matchAll(/<li\b/g)];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it.each([...ROUTES])("/%s/: toda ancla del menú tiene a dónde llegar", (route) => {
    const html = pageOf(route);
    // Sin pendientes: `#plans` tiene destino desde F11-SITE-PLANS-02. Si algún
    // día vuelve a haber un ancla sin sección, que sea a propósito y con nombre.
    const pending: string[] = [];
    const targets = new Set([...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1] as string));
    for (const id of targets) {
      if (pending.includes(id)) continue;
      expect(html, `#${id}`).toMatch(new RegExp(`\\bid="${id}"`));
    }
  });

  it("el menú del celular es un <dialog>: atrapa el foco y cierra con Escape solo", () => {
    expect(pageOf("es-mx")).toMatch(/<dialog\b[^>]*data-mobile-menu/);
  });
});

describe("hero y la caja dibujada (PAGE-02)", () => {
  it.each([...ROUTES])("/%s/ dibuja la caja con SUS productos y SU moneda", (route) => {
    const { market } = getLocale(route);
    const { mock } = getMessages(route).hero;
    const hero = pageOf(route);
    for (const item of Object.values(mock.items)) expect(hero).toContain(escaped(item.name));
    expect(hero).toContain(MOCK_SALE[market].barcode);
    expect(hero).toContain(formatMoney(mockTotal(market), route));
    for (const line of MOCK_SALE[market].lines) {
      expect(hero).toContain(formatMoney(line, route));
    }
  });

  it("México cobra en pesos los productos del prototipo", () => {
    expect(pageOf("es-mx")).toContain("$241.90");
    expect(pageOf("es-mx")).toContain("Agua natural 1 L");
  });

  it("el total es la suma de sus líneas: la caja no puede mentir", () => {
    for (const sale of Object.values(MOCK_SALE)) {
      const sum = sale.lines.reduce((total, line) => total + line, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(sale.total * 100));
    }
  });

  it("la caja es HTML, no una imagen", () => {
    const html = pageOf("es-mx");
    const hero = html.slice(html.indexOf('class="hero'), html.indexOf("</header>"));
    expect(hero).not.toMatch(/<img\b/);
  });
});

describe("qué hace (PAGE-03)", () => {
  it.each([...ROUTES])(
    "/%s/ tiene los cuatro verbos, y Controla y Compra dicen su plan",
    (route) => {
      const { whatItDoes, planTags } = getMessages(route);
      const section = sectionOf(pageOf(route), ANCHORS.whatItDoes);
      const rows = [...section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) =>
        textOf(m[1] as string),
      );
      expect(rows).toEqual(
        [
          whatItDoes.items.sell,
          whatItDoes.items.track,
          whatItDoes.items.buy,
          whatItDoes.items.decide,
        ].map((item) => item.title),
      );
      expect(section.split(escaped(planTags.fromPro)).length - 1).toBe(2);
    },
  );
});

describe("beneficios (PAGE-04)", () => {
  it.each([...ROUTES])(
    "/%s/ tiene seis, en el orden de su mercado, con su palabra subrayada",
    (route) => {
      const { benefits } = getMessages(route);
      const section = sectionOf(pageOf(route), ANCHORS.benefits);
      const titles = [...section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(
        (m) => m[1] as string,
      );
      expect(titles).toHaveLength(6);
      for (const title of titles) expect(title).toMatch(/<em\b[^>]*>[^<]+<\/em>/);
      expect(titles.map(textOf)).toEqual(
        BENEFIT_ORDER[route].map((id) => benefits.items[id].title.replaceAll("*", "")),
      );
    },
  );

  it("en Canadá las caducidades suben al segundo lugar (CONTENIDO §7.5)", () => {
    expect(BENEFIT_ORDER["en-ca"][1]).toBe("expiry");
    expect(BENEFIT_ORDER["fr-ca"][1]).toBe("expiry");
    expect(BENEFIT_ORDER["es-mx"][1]).not.toBe("expiry");
  });

  it.each([...ROUTES])("/%s/: lo que es de un plan lo dice (Desde Pro, En Plus)", (route) => {
    const { planTags } = getMessages(route);
    const section = sectionOf(pageOf(route), ANCHORS.benefits);
    expect(section).toContain(escaped(planTags.fromPro));
    expect(section).toContain(escaped(planTags.onPlus));
  });
});

describe("para quién (PAGE-05)", () => {
  it.each([...ROUTES])("/%s/ lista los giros de SU mercado", (route) => {
    const { whoFor } = getMessages(route);
    const section = sectionOf(pageOf(route), "who-for");
    for (const trade of whoFor.trades) expect(section).toContain(escaped(trade));
  });

  it("«Consultorios» solo existe en México, y es la única píldora que es un enlace", () => {
    for (const route of ROUTES) {
      const section = sectionOf(pageOf(route), "who-for");
      const links = [...section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
      if (route === "es-mx") {
        expect(links).toHaveLength(1);
        expect(textOf(links[0]?.[2] ?? "")).toBe(getMessages(route).whoFor.clinics);
        // Abre el formulario con «Algo a la medida» ya elegido (LEAD-07 lo lee).
        expect(links[0]?.[1]).toContain(`href="?plan=custom#${ANCHORS.contact}"`);
      } else {
        expect(links, route).toHaveLength(0);
        expect(section, route).not.toContain(getMessages(route).whoFor.clinics);
      }
    }
  });

  it("una tlapalería no existe en Ontario", () => {
    expect(pageOf("es-mx")).toContain("Tlapalerías");
    expect(pageOf("en-ca")).not.toMatch(/Tlapaler/);
    expect(pageOf("en-us")).not.toMatch(/Pharmac/);
  });
});

describe("preguntas frecuentes (PAGE-06)", () => {
  it.each([...ROUTES])("/%s/ usa <details>: funciona sin JavaScript", (route) => {
    const { faq } = getMessages(route);
    const section = sectionOf(pageOf(route), ANCHORS.faq);
    const questions = [...section.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map((m) =>
      textOf(m[1] as string),
    );
    expect(questions).toEqual(FAQ_ORDER[route].map((id) => faq.items[id].q));
    expect([...section.matchAll(/<details\b/g)]).toHaveLength(FAQ_ORDER[route].length);
  });

  it("las ocho comunes van en todas; las de impuestos y personal, solo donde aplican", () => {
    expect(FAQ_ORDER["es-mx"]).toHaveLength(8);
    expect(FAQ_ORDER["es-mx"]).not.toContain("salesTax");
    expect(FAQ_ORDER["en-us"]).toEqual(expect.arrayContaining(["staffLanguage", "salesTax"]));
    expect(FAQ_ORDER["es-us"]).toEqual(expect.arrayContaining(["staffLanguage", "salesTax"]));
    expect(FAQ_ORDER["en-ca"]).toContain("canadaTax");
    expect(FAQ_ORDER["fr-ca"]).toContain("canadaTax");
    expect(FAQ_ORDER["en-ca"]).not.toContain("salesTax");
  });

  it("el francés dice que la aplicación todavía no está en francés", () => {
    expect(sectionOf(pageOf("fr-ca"), ANCHORS.faq)).toContain(
      "Le français sera bientôt disponible",
    );
  });
});

describe("cierre y pie (PAGE-07)", () => {
  it.each([...ROUTES])("/%s/ cierra con su titular y sus dos botones", (route) => {
    const { closing } = getMessages(route);
    const section = sectionOf(pageOf(route), ANCHORS.contact);
    expect(section).toContain(escaped(closing.title));
    expect(section).toContain(`href="${APP_REGISTER_URL}"`);
    expect(textOf(section)).toContain(closing.secondaryCta);
  });

  it("el año del pie se calcula al construir", () => {
    const html = pageOf("es-mx");
    const footer = html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>"));
    expect(footer).toContain(`© ${new Date().getFullYear()}`);
  });

  it("el pie repite las anclas y lleva el selector", () => {
    const html = pageOf("en-us");
    const footer = html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>"));
    expect(footer).toContain(`href="#${ANCHORS.faq}"`);
    expect(footer).toContain("data-market-switcher");
  });
});

describe("la página entera", () => {
  it.each([...ROUTES])("/%s/ no deja marcas de énfasis sin convertir", (route) => {
    const html = pageOf(route);
    const body = textOf(html.slice(html.indexOf("<body"), html.indexOf("</body>")));
    expect(body).not.toMatch(/\*/);
  });

  it.each([...ROUTES])("/%s/ tiene un solo <h1> y las secciones en el orden aprobado", (route) => {
    const html = pageOf(route);
    expect([...html.matchAll(/<h1\b/g)]).toHaveLength(1);
    const order = [
      ANCHORS.whatItDoes,
      ANCHORS.benefits,
      "who-for",
      ANCHORS.faq,
      ANCHORS.contact,
    ].map((id) => html.search(new RegExp(`<section\\b[^>]*\\bid="${id}"`)));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
