import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANCHORS, APP_LOGIN_URL, APP_REGISTER_URL, appUrl } from "../src/config/links";
import { formatMoney, getLocale, ROUTES, type Route } from "../src/config/markets";
import {
  BENEFIT_ORDER,
  FAQ_ORDER,
  MOCK_DASHBOARD,
  MOCK_SALE,
  MOCK_SALE_QUANTITIES,
  MOCK_SALE_WEIGHT,
  mockAverageTicket,
  mockTopSellers,
  mockTotal,
} from "../src/config/page";
import { getMessages } from "../src/i18n";
import { DIST, distFiles, readDist } from "./dist";

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
    expect(html).toContain(`href="${appUrl(APP_LOGIN_URL, route)}"`);
    expect(html).toContain(`href="${appUrl(APP_REGISTER_URL, route)}"`);
  });

  /**
   * El idioma viaja con la persona (Carlos, 2026-09-19): quien leyó el sitio
   * en español entra a la aplicación en español, no en inglés —que es como
   * arranca la aplicación cuando nadie eligió nada—.
   */
  it.each([...ROUTES])("/%s/: las dos puertas de la aplicación llevan su idioma", (route) => {
    const { language } = getLocale(route);
    const html = pageOf(route);
    // El francés todavía no existe DENTRO de la aplicación: va en inglés, que
    // es lo que esa persona va a ver de verdad.
    const esperado = language === "fr" ? "en" : language;

    for (const puerta of [APP_LOGIN_URL, APP_REGISTER_URL]) {
      expect(appUrl(puerta, route)).toBe(`${puerta}?lang=${esperado}`);
      expect(html).toContain(`href="${appUrl(puerta, route)}"`);
    }
    expect(html).not.toContain(`href="${APP_REGISTER_URL}"`);
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

  // El segundo renglón se vende POR PESO (2026-09-21): quien vende queso, carne
  // o semillas ve de un vistazo que la caja no es solo para piezas. El nombre
  // no lleva gramaje —eso sería un empaque— y el peso va donde iría «1 pieza».
  it.each([...ROUTES])(
    "/%s/: el segundo producto se vende por peso, en la unidad de su mercado",
    (route) => {
      const { market } = getLocale(route);
      const { second } = getMessages(route).hero.mock.items;
      expect(second.name).not.toMatch(/\d/);
      expect(second.detail).toMatch(market === "us" ? /^\d+ oz$/ : /^\d+\s?g$/);
      expect(pageOf(route)).toContain(escaped(second.detail));
    },
  );

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

  // PAGE-10 — antes del beneficio va lo que el negocio hace HOY a mano: el
  // visitante se reconoce en el dolor y lee el titular como la respuesta.
  it.each([...ROUTES])(
    "/%s/: cada celda abre con el dolor de «Hoy», ANTES de su titular",
    (route) => {
      const { benefits } = getMessages(route);
      const section = sectionOf(pageOf(route), ANCHORS.benefits);
      const cells = [...section.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].map(
        (m) => m[1] as string,
      );
      expect(cells).toHaveLength(6);
      BENEFIT_ORDER[route].forEach((id, index) => {
        const cell = cells[index] as string;
        const { pain } = benefits.items[id];
        expect(pain.length, `${route}/${id} sin dolor`).toBeGreaterThan(20);
        const text = textOf(cell);
        expect(text.startsWith(`${benefits.painLabel} ${pain}`), `${route}/${id}: ${text}`).toBe(
          true,
        );
        expect(cell.indexOf(escaped(pain))).toBeLessThan(cell.indexOf("<h3"));
      });
    },
  );

  it.each([...ROUTES])("/%s/: un dolor es una escena, no una estadística inventada", (route) => {
    const { benefits } = getMessages(route);
    for (const id of BENEFIT_ORDER[route]) {
      expect(benefits.items[id].pain, `${route}/${id}`).not.toMatch(/\d|%/);
    }
  });

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

  it("una papelería no existe en Ontario", () => {
    expect(pageOf("es-mx")).toContain("Papelerías");
    expect(pageOf("en-ca")).not.toMatch(/Papeler/);
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

  it("la impresora va justo después del lector: son las dos dudas de equipo", () => {
    for (const route of ROUTES) {
      const order = FAQ_ORDER[route];
      expect(order.indexOf("printer"), route).toBe(order.indexOf("scanner") + 1);
    }
    // Se imprime por el navegador: prometer una marca o un sistema sería mentir.
    expect(getMessages("es-mx").faq.items.printer.a).not.toMatch(/android|windows|epson/i);
  });

  it("las nueve comunes van en todas; las de impuestos y personal, solo donde aplican", () => {
    expect(FAQ_ORDER["es-mx"]).toHaveLength(9);
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
    expect(section).toContain(`href="${appUrl(APP_REGISTER_URL, route)}"`);
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

describe("en tu mostrador: la foto (PAGE-08)", () => {
  it.each([...ROUTES])("/%s/ tiene la foto con su texto alterno y sus tres pasos", (route) => {
    const { inAction } = getMessages(route);
    const section = sectionOf(pageOf(route), ANCHORS.inAction);
    expect(textOf(section)).toContain(inAction.title);
    const steps = [...section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) =>
      textOf(m[1] as string),
    );
    expect(steps).toEqual(
      [inAction.steps.scan, inAction.steps.charge, inAction.steps.ticket].map((s) => s.title),
    );
    const img = section.match(/<img\b[^>]*>/)?.[0] ?? "";
    expect(img).toContain(`alt="${inAction.imageAlt.replace(/"/g, "&quot;")}"`);
    // La imagen es de estudio, no de un cliente: se dice.
    expect(textOf(section)).toContain(inAction.caption);
    // «Imagen ilustrativa» a secas no dice DE QUÉ: el pie nombra lo que se ve.
    expect(inAction.caption).toContain("SellPointy");
  });

  it("la foto no hace saltar la página ni estorba al titular", () => {
    const section = sectionOf(pageOf("es-mx"), ANCHORS.inAction);
    const img = section.match(/<img\b[^>]*>/)?.[0] ?? "";
    // Con ancho y alto el navegador aparta el hueco antes de bajarla.
    expect(img).toMatch(/\bwidth="\d+"/);
    expect(img).toMatch(/\bheight="\d+"/);
    // Va debajo del primer pantallazo: no compite con el titular por la red.
    expect(img).toContain('loading="lazy"');
    expect(section).toMatch(/<source\b[^>]*type="image\/avif"/);
    expect(section).toMatch(/<source\b[^>]*type="image\/webp"/);
  });

  it("ninguna imagen del sitio pesa más de 250 KB: el original de 2 MB no viaja", () => {
    const images = distFiles().filter((file) => /\.(png|jpe?g|webp|avif)$/.test(file));
    expect(images.length).toBeGreaterThan(0);
    for (const file of images) {
      expect(statSync(join(DIST, file)).size, file).toBeLessThan(250 * 1024);
    }
  });
});

describe("tu panel: el tablero dibujado (PAGE-09)", () => {
  it.each([...ROUTES])("/%s/ dibuja el panel con SU moneda y SUS productos", (route) => {
    const { market } = getLocale(route);
    const { insights, hero } = getMessages(route);
    const data = MOCK_DASHBOARD[market];
    const section = sectionOf(pageOf(route), ANCHORS.insights);
    expect(textOf(section)).toContain(insights.title);
    for (const point of insights.points) expect(textOf(section)).toContain(point);
    for (const amount of [data.today, data.month, data.profit, mockAverageTicket(market)]) {
      expect(section, String(amount)).toContain(formatMoney(amount, route));
    }
    // Los más vendidos son los MISMOS productos de la caja del hero.
    for (const item of Object.values(hero.mock.items)) {
      expect(section).toContain(escaped(item.name));
    }
    for (const seller of mockTopSellers(market)) {
      expect(section).toContain(formatMoney(seller.amount, route));
    }
  });

  it("el panel es HTML y SVG, no una captura", () => {
    const section = sectionOf(pageOf("es-mx"), ANCHORS.insights);
    expect(section).not.toMatch(/<img\b/);
    expect(section).toMatch(/role="img"/);
    expect(section).toContain(`aria-label="${getMessages("es-mx").insights.mock.label}"`);
    expect(section).toMatch(/<svg\b/);
  });

  // Lo que se vende por peso se cuenta por peso: «31 unidades» de queso no le
  // dice nada a quien lo despacha por kilo (Carlos, 2026-09-21).
  it.each([
    ["es-mx", "7.75 kg"],
    ["en-us", "13.5 lb"],
    ["es-us", "13.5 lb"],
    ["en-ca", "6.5 kg"],
    ["fr-ca", "6,5 kg"],
  ] as const)("/%s/: el queso de «Más vendidos» dice %s, no unidades", (route, peso) => {
    const { market } = getLocale(route);
    const [, queso] = mockTopSellers(market);
    const text = textOf(sectionOf(pageOf(route), ANCHORS.insights)).replace(/\u00a0|\u202f/g, " ");
    expect(text).toContain(peso);
    const unidades = getMessages(route).insights.mock.units.replace(
      "{count}",
      String(queso?.units),
    );
    expect(text).not.toContain(unidades);
    // Y el peso es el de la caja del hero: cada venta del panel es una porción de esas.
    expect(queso?.weight?.value).toBe((queso?.units ?? 0) * MOCK_SALE_WEIGHT[market].perSale);
  });

  it("los números del panel cuadran entre sí: un tablero no puede mentir", () => {
    for (const market of Object.keys(MOCK_DASHBOARD) as (keyof typeof MOCK_DASHBOARD)[]) {
      const data = MOCK_DASHBOARD[market];
      expect(data.goalPercent).toBeGreaterThan(0);
      expect(data.goalPercent).toBeLessThanOrEqual(100);
      // La utilidad es una parte de lo vendido, y hoy es una parte del mes.
      expect(data.profit).toBeLessThan(data.month);
      expect(data.today).toBeLessThan(data.month);
      // El promedio se redondea a centavos: la diferencia no pasa de medio
      // centavo por ticket.
      expect(Math.abs(mockAverageTicket(market) * data.tickets - data.today)).toBeLessThan(
        data.tickets * 0.005 + 0.001,
      );
      // Cada «más vendido» cuesta lo mismo que en la caja del hero.
      const sale = MOCK_SALE[market];
      mockTopSellers(market).forEach((seller, index) => {
        const unitPrice = (sale.lines[index] ?? 0) / (MOCK_SALE_QUANTITIES[index] ?? 1);
        expect(Math.round(seller.amount * 100)).toBe(Math.round(unitPrice * seller.units * 100));
        expect(seller.amount).toBeLessThan(data.today);
      });
    }
  });

  it("el panel no promete existencias: Basic no las lleva y el panel es de todos los planes", () => {
    for (const route of ROUTES) {
      const text = textOf(sectionOf(pageOf(route), ANCHORS.insights));
      expect(text, route).not.toMatch(/agotad|out of stock|rupture/i);
      expect(text).toContain(getMessages(route).insights.note);
    }
  });
});

describe("la página entera", () => {
  it.each([...ROUTES])("/%s/ no deja marcas de énfasis sin convertir", (route) => {
    const html = pageOf(route);
    // Sin los guiones: Astro incrusta los pequeños en la página, y un selector
    // como `a[href*="#"]` no es texto que alguien lea.
    const markup = html
      .slice(html.indexOf("<body"), html.indexOf("</body>"))
      .replace(/<script[\s\S]*?<\/script>/g, "");
    const body = textOf(markup);
    expect(body).not.toMatch(/\*/);
  });

  it.each([...ROUTES])("/%s/ tiene un solo <h1> y las secciones en el orden aprobado", (route) => {
    const html = pageOf(route);
    expect([...html.matchAll(/<h1\b/g)]).toHaveLength(1);
    const order = [
      ANCHORS.whatItDoes,
      ANCHORS.inAction,
      ANCHORS.benefits,
      ANCHORS.insights,
      "who-for",
      ANCHORS.faq,
      ANCHORS.contact,
    ].map((id) => html.search(new RegExp(`<section\\b[^>]*\\bid="${id}"`)));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
