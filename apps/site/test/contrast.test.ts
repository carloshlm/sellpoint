import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// F11-SITE-SEO-04 — el contraste, calculado desde los tokens y no a ojo. Cubre
// lo que una herramienta SÍ puede decidir; recorrer la página con teclado y con
// lector de pantalla sigue siendo trabajo de una persona.

type Rgba = [number, number, number, number];

const css = readFileSync(
  fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return new Map(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
}
const LIGHT = declarations(":root {");
const DARK = new Map([...LIGHT, ...declarations(':root[data-theme="dark"]')]);

function parse(value: string, theme: Map<string, string>): Rgba {
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return parse(theme.get(ref[1] as string) as string, theme);
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = value.match(/^rgba\(([^)]+)\)$/);
  if (rgba) return (rgba[1] as string).split(",").map(Number) as Rgba;
  throw new Error(`No sé leer el color «${value}»`);
}
/** Un color translúcido se ve mezclado con lo que tiene detrás. */
const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
  r * a + br * (1 - a),
  g * a + bg * (1 - a),
  b * a + bb * (1 - a),
  1,
];
function luminance([r, g, b]: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(fg: string, bg: string, theme: Map<string, string>): number {
  const back = parse(theme.get(bg) as string, theme);
  const front = over(parse(theme.get(fg) as string, theme), back);
  const [hi, lo] = [luminance(front), luminance(back)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [texto, fondo] — los pares que de verdad aparecen en el sitio. */
const TEXT_PAIRS: [string, string][] = [
  ["--ink", "--ground"],
  ["--ink", "--surface"],
  ["--muted", "--ground"],
  ["--muted", "--surface"],
  ["--eyebrow", "--ground"],
  ["--eyebrow", "--surface"],
  ["--on-blue", "--blue"],
  // El primer sospechoso de la tarea: blanco al 80 % sobre el azul.
  ["--on-blue-muted", "--blue"],
  ["--on-blue-muted", "--blue-deep"],
  ["--on-dot", "--dot"],
  ["--mock-ink", "--mock"],
  ["--mock-muted", "--mock"],
  ["--ground", "--ink"],
];

describe.each([
  ["claro", LIGHT],
  ["oscuro", DARK],
] as const)("contraste AA en tema %s", (_name, theme) => {
  it.each(TEXT_PAIRS)("%s sobre %s ≥ 4.5", (fg, bg) => {
    expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5);
  });

  it("el foco se ve sobre CUALQUIER fondo: alguno de sus dos anillos llega a 3:1", () => {
    // El segundo sospechoso: el amarillo sobre blanco. El anillo amarillo solo
    // NO alcanza sobre un fondo claro (1.4:1), así que el foco lleva dos
    // anillos —amarillo y tinta— y siempre hay uno que contrasta.
    // El anillo va POR FUERA del elemento: lo que tiene al lado es el fondo de
    // la sección, no el del botón.
    for (const background of ["--ground", "--surface", "--blue", "--blue-deep"]) {
      const best = Math.max(
        contrast("--dot", background, theme),
        contrast("--ink", background, theme),
      );
      expect(best, background).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("el foco de verdad lleva los dos anillos", () => {
  it("global.css declara el anillo de tinta junto al amarillo", () => {
    const global = readFileSync(
      fileURLToPath(new URL("../src/styles/global.css", import.meta.url)),
      "utf8",
    );
    const rule = global.slice(global.indexOf(":focus-visible"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/outline:[^;]*var\(--dot\)/);
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/box-shadow:[^;]*var\(--ink\)/);
  });
});
