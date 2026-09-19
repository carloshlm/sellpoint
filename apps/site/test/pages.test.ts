import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE, getLocale, ROUTES } from "../src/config/markets";
import { getMessages } from "../src/i18n";
import { distPages, readDist } from "./dist";

// F11-SITE-BASE-04 y BASE-05 — las rutas y la plantilla, leídas del sitio construido.

const pageOf = (route: string) => readDist(`${route}/index.html`);
const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));
/** El texto tal como lo escribe Astro en un atributo o en el cuerpo. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

describe("rutas por mercado e idioma", () => {
  it("se construyen las cinco, más la raíz — y nada más", () => {
    const expected = ["index.html", ...ROUTES.map((route) => `${route}/index.html`)];
    expect(distPages().sort()).toEqual(expected.sort());
  });

  it.each([...ROUTES])("/%s/ declara su idioma en <html lang>", (route) => {
    expect(pageOf(route)).toContain(`<html lang="${getLocale(route).htmlLang}"`);
  });

  it.each([...ROUTES])("/%s/ lleva el título y la descripción de su idioma", (route) => {
    const { meta } = getMessages(route);
    const head = headOf(pageOf(route));
    expect(head).toContain(`<title>${escaped(meta.title)}</title>`);
    expect(head).toContain(`<meta name="description" content="${escaped(meta.description)}"`);
  });

  it("la raíz es la versión de México COMPLETA, no una redirección", () => {
    const root = readDist("index.html");
    expect(root).toContain(`<html lang="${getLocale(DEFAULT_ROUTE).htmlLang}"`);
    expect(root).not.toMatch(/http-equiv="refresh"/i);
    const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main(root)).toBe(main(pageOf(DEFAULT_ROUTE)));
    expect(main(root).length).toBeGreaterThan(200);
  });
});

describe("plantilla base", () => {
  it.each([...ROUTES])("/%s/ abre con «saltar al contenido», y el destino existe", (route) => {
    const html = pageOf(route);
    const body = html.slice(html.indexOf("<body"));
    const firstLink = body.match(/<a\b[^>]*>([\s\S]*?)<\/a>/);
    expect(firstLink?.[0]).toContain('href="#main"');
    expect(firstLink?.[1]?.trim()).toBe(escaped(getMessages(route).a11y.skipToContent));
    expect(html).toMatch(/<main[^>]*\bid="main"/);
  });

  it("el tema se decide ANTES de pintar: guion en línea, en el <head>, sin aplazar", () => {
    // Un guion de módulo o con `defer` corre después del primer pintado: quien
    // eligió oscuro vería un destello blanco en cada carga.
    for (const page of distPages()) {
      const head = headOf(readDist(page));
      const script = head.match(/<script\b([^>]*)>([\s\S]*?)<\/script>/);
      expect(script, page).not.toBeNull();
      expect(script?.[1], page).not.toMatch(/type="module"|defer|async|src=/);
      expect(script?.[2], page).toContain("data-theme");
      // `localStorage` puede tronar (modo privado, datos bloqueados).
      expect(script?.[2], page).toContain("try");
    }
  });

  it("mientras sea un andamiaje, ninguna página se deja indexar", () => {
    // Se quita en F11-SITE-SEO-01, junto con la canónica y el hreflang.
    for (const page of distPages()) {
      expect(headOf(readDist(page)), page).toContain('<meta name="robots" content="noindex"');
    }
  });

  it("el andamiaje no manda JavaScript de más: solo el guion del tema", () => {
    for (const page of distPages()) {
      const scripts = [...readDist(page).matchAll(/<script\b/g)];
      expect(scripts, page).toHaveLength(1);
    }
  });
});
