import { describe, expect, it } from "vitest";
import { cssOf, distFiles, distPages, readDist } from "./dist";

// F11-SITE-BASE-03 — las fuentes salen del propio dominio. Un tercero menos en
// la ruta crítica y una transferencia de IP a Google menos que declarar en el
// aviso de privacidad.
const THIRD_PARTY_FONTS = /fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/;

describe("fuentes", () => {
  it("ninguna página pide una fuente a un tercero", () => {
    for (const page of distPages()) {
      expect(readDist(page), page).not.toMatch(THIRD_PARTY_FONTS);
      expect(cssOf(page), page).not.toMatch(THIRD_PARTY_FONTS);
    }
  });

  it("viajan solo tres archivos, todos woff2: titulares, texto y datos", () => {
    const fonts = distFiles().filter((file) => /\.(woff2?|ttf|otf|eot)$/.test(file));
    expect(fonts.filter((file) => !file.endsWith(".woff2"))).toEqual([]);
    expect(fonts).toHaveLength(3);
  });

  it("se precarga UNA sola fuente: la del titular", () => {
    // Precargar las tres sería quitarle ancho de banda al HTML y al CSS para
    // traer antes la monoespaciada, que vive dentro de la caja dibujada.
    for (const page of distPages()) {
      const preloads = [...readDist(page).matchAll(/<link[^>]+rel="preload"[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => tag.includes('as="font"'));
      expect(preloads, page).toHaveLength(1);
      expect(preloads[0]).toContain("woff2");
      // Sin `crossorigin` el navegador descarga la fuente DOS veces.
      expect(preloads[0]).toContain("crossorigin");
    }
  });

  it("todas las familias usan font-display: swap", () => {
    const css = cssOf("index.html");
    const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
    const webFonts = faces.filter((face) => face.includes("url("));
    expect(webFonts.length).toBeGreaterThanOrEqual(3);
    for (const face of webFonts) expect(face).toMatch(/font-display:\s*swap/);
  });

  it("titulares y texto tienen un respaldo con métricas ajustadas", () => {
    // El respaldo es una fuente del sistema «estirada» (`size-adjust` y
    // compañía) para ocupar lo mismo que la de verdad: el texto no salta
    // cuando termina de cargar.
    const css = cssOf("index.html");
    const fallbacks = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)]
      .map((m) => m[0])
      .filter((face) => face.includes("size-adjust"));
    expect(fallbacks.length).toBeGreaterThanOrEqual(2);
  });
});
