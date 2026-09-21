import { PRIVACY_URL, TERMS_URL } from "@sellpoint/shared";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCS, LEGAL_SLUGS, legalPath } from "../src/config/legal";
import { getLocale, ROUTES } from "../src/config/markets";
import { absoluteUrl } from "../src/config/seo";
import { findHoles, loadLegalDocument } from "../src/legal/load";
import { distPages, readDist } from "./dist";

// F11-SITE-LEGAL-01 — las páginas legales, que se arman LEYENDO
// `SITIO-WEB-LEGAL.md`: una sola fuente para el texto.

describe("el documento legal", () => {
  it.each(["es", "en", "fr"] as const)(
    "%s trae el aviso (P1–P11), los términos (T1–T18) y el anexo de consultorio (A1–A11)",
    (language) => {
      const privacy = loadLegalDocument(language, "privacy");
      const terms = loadLegalDocument(language, "terms");
      expect(privacy.sections.map((s) => s.id)).toEqual(
        Array.from({ length: 11 }, (_, i) => `p${i + 1}`),
      );
      // El anexo vive DENTRO de los términos: se acepta con ellos y los anclajes
      // son los mismos en los tres idiomas.
      expect(terms.sections.map((s) => s.id)).toEqual([
        ...Array.from({ length: 18 }, (_, i) => `t${i + 1}`),
        ...Array.from({ length: 11 }, (_, i) => `a${i + 1}`),
      ]);
      expect(privacy.title.length).toBeGreaterThan(5);
    },
  );

  // 2026-09-21 — lo que protege a SellPointy de lo que capturan sus clientes.
  // Si una de estas cláusulas desaparece en una edición, que se note.
  it.each([
    [
      "es",
      /único responsable de esa información/,
      /sacas en paz y a salvo/,
      /NOM-024-SSA3-2012/,
      /no está certificado/,
    ],
    [
      "en",
      /solely responsible for that information/,
      /hold us harmless/,
      /NOM-024-SSA3-2012/,
      /is not certified/,
    ],
    [
      "fr",
      /seul responsable de ces informations/,
      /dégagez de toute responsabilité/,
      /NOM-024-SSA3-2012/,
      /n'est pas certifié/,
    ],
  ] as const)(
    "%s: el cliente responde por su información y el anexo dice la verdad sobre la NOM-024",
    (language, responsable, indemniza, norma, sinCertificar) => {
      const text = loadLegalDocument(language, "terms")
        .html.replace(/<[^>]+>/g, "")
        .replace(/&#39;/g, "'")
        // El documento parte los renglones a 85 columnas: una frase puede venir cortada.
        .replace(/\s+/g, " ");
      expect(text).toMatch(responsable);
      expect(text).toMatch(indemniza);
      expect(text).toMatch(norma);
      expect(text).toMatch(sinCertificar);
    },
  );

  it.each(["es", "en", "fr"] as const)(
    "%s: el aviso dice quién responde por los datos que capturan los clientes",
    (language) => {
      const { sections } = loadLegalDocument(language, "privacy");
      expect(sections[2]?.id).toBe("p3");
      expect(sections[2]?.title).toMatch(/clientes capturan|customers enter|clients saisissent/);
    },
  );

  it("las marcas internas de riesgo (🔴) y las notas a Carlos NO se publican", () => {
    for (const language of ["es", "en", "fr"] as const) {
      for (const doc of LEGAL_DOCS) {
        const { html, sections } = loadLegalDocument(language, doc);
        expect(html).not.toContain("🔴");
        // «Carlos» solo puede aparecer como el RESPONSABLE, con su nombre completo.
        // Suelto («Carlos decidió…») es una nota de edición que se coló.
        expect(html.replaceAll("Carlos Hernandez Hernandez", "")).not.toMatch(/Carlos/);
        for (const section of sections) expect(section.title).not.toMatch(/^[PTA]\d+\./);
      }
    }
  });

  it("findHoles ve cada hueco, y un texto limpio no tiene ninguno", () => {
    expect(findHoles("con domicilio en [[domicilio]] y [[correo]].")).toEqual([
      "[[domicilio]]",
      "[[correo]]",
    ]);
    expect(findHoles("un texto [sin] huecos")).toEqual([]);
  });
});

describe("páginas legales construidas", () => {
  it("cada ruta tiene sus dos páginas, con la dirección en SU idioma", () => {
    for (const route of ROUTES) {
      for (const doc of LEGAL_DOCS) {
        expect(distPages(), `${route}:${doc}`).toContain(
          `${legalPath(route, doc).slice(1)}index.html`,
        );
      }
    }
    expect(legalPath("es-mx", "privacy")).toBe("/es-mx/privacidad/");
    expect(legalPath("en-ca", "terms")).toBe("/en-ca/terms/");
    expect(LEGAL_SLUGS.fr.terms).toBe("conditions");
  });

  it.each([...ROUTES])(
    "/%s/: idioma correcto, anclas por sección y un índice que lleva a ellas",
    (route) => {
      const html = readDist(`${legalPath(route, "terms").slice(1)}index.html`);
      expect(html).toContain(`<html lang="${getLocale(route).htmlLang}"`);
      for (let n = 1; n <= 16; n++) {
        expect(html).toMatch(new RegExp(`<h2[^>]*\\bid="t${n}"`));
        expect(html).toContain(`href="#t${n}"`);
      }
      expect([...html.matchAll(/<h1\b/g)]).toHaveLength(1);
    },
  );

  it("se pueden imprimir: el menú y el pie no salen en papel", () => {
    const html = readDist("es-mx/terminos/index.html");
    const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
      .map((m) => readDist((m[1] as string).slice(1)))
      .concat([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] as string))
      .join("\n");
    expect(css).toMatch(/@media print/);
  });

  it("el pie de TODAS las páginas enlaza a las dos, y la casilla del formulario al aviso", () => {
    for (const route of ROUTES) {
      const home = readDist(`${route}/index.html`);
      expect(home).toContain(`href="${legalPath(route, "privacy")}"`);
      expect(home).toContain(`href="${legalPath(route, "terms")}"`);
      const consent = home.slice(home.indexOf("data-consent-text"));
      expect(consent.slice(0, 900)).toContain(`href="${legalPath(route, "privacy")}"`);
    }
  });

  it("sin hero azul, el menú va SIEMPRE con fondo: transparente no se leería", () => {
    // Cazado en el navegador: textos blancos sobre el fondo claro de la página.
    expect(readDist("es-mx/privacidad/index.html")).toMatch(
      /<div\b[^>]*data-site-nav[^>]*data-solid/,
    );
    expect(readDist("es-mx/index.html")).not.toMatch(/<div\b[^>]*data-site-nav[^>]*data-solid/);
  });

  it("desde una página legal, el menú regresa a las secciones de la portada", () => {
    const html = readDist("fr-ca/conditions/index.html");
    expect(html).toContain('href="/fr-ca/#plans"');
    expect(html).not.toMatch(/href="#plans"/);
  });

  it("la APLICACIÓN enlaza a estas mismas direcciones (las suyas viven en shared)", () => {
    // El registro y el aviso de términos de la app llevan a estas páginas. Si
    // una de las dos cambia de dirección sin la otra, el enlace de «Acepto los
    // Términos» lleva a una 404.
    expect(TERMS_URL.es).toBe(absoluteUrl(legalPath("es-mx", "terms")));
    expect(TERMS_URL.en).toBe(absoluteUrl(legalPath("en-us", "terms")));
    expect(PRIVACY_URL.es).toBe(absoluteUrl(legalPath("es-mx", "privacy")));
    expect(PRIVACY_URL.en).toBe(absoluteUrl(legalPath("en-us", "privacy")));
  });

  it("CANDADO: hoy los huecos existen, y viven SOLO en las páginas legales", () => {
    // Publicar con un hueco está prohibido (`pnpm --filter site check:publishable`
    // lo impide en el pipeline). Esta prueba cuida lo otro: que un `[[` no
    // aparezca jamás fuera de lo legal, donde nadie lo buscaría.
    const legal = new Set(
      ROUTES.flatMap((r) => LEGAL_DOCS.map((d) => `${legalPath(r, d).slice(1)}index.html`)),
    );
    for (const page of distPages()) {
      if (!legal.has(page)) expect(findHoles(readDist(page)), page).toEqual([]);
    }
  });
});
