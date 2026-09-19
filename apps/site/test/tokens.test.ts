import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND_BLUE } from "../src/styles/tokens";

// F11-SITE-BASE-02 — los colores viven en UN archivo. Un color escrito a mano
// en un componente es un color que el tema oscuro no conoce y que nadie
// encuentra el día que cambie la marca.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const TOKENS_CSS = join(SRC, "styles/tokens.css");
// Los dos únicos archivos donde un color puede ir escrito: los tokens y su
// espejo en TypeScript (el `theme-color` del <head> no puede leer una variable).
const ALLOWED = new Set(["styles/tokens.css", "styles/tokens.ts"]);

// Largos válidos de un color hexadecimal: 3, 4, 6 u 8. Así `#beneficios` o
// `#planes` —las anclas del menú— no se confunden con un color.
const COLOR_LITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(astro|css|ts|js|mjs|svg)$/.test(entry.name) ? [path] : [];
  });
}

/** Las declaraciones `--token: valor` de un bloque, como mapa. */
function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1] as string, (match[2] as string).trim());
  }
  return map;
}

/** El cuerpo `{…}` del primer bloque cuyo selector contiene `selector`. */
function blockOf(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `no existe el bloque ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("tokens de diseño", () => {
  // Sin comentarios: la cabecera del archivo nombra los selectores al explicarlos.
  const css = readFileSync(TOKENS_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("define los once colores con nombre de la guía (§2)", () => {
    const light = declarations(blockOf(css, ":root {"));
    for (const token of [
      "--ground",
      "--surface",
      "--ink",
      "--muted",
      "--line",
      "--blue",
      "--blue-deep",
      "--on-blue",
      "--on-blue-muted",
      "--dot",
      "--on-dot",
    ]) {
      expect(light.has(token), `falta ${token}`).toBe(true);
    }
    expect(light.get("--blue")?.toLowerCase()).toBe("#1e3fd8");
    expect(light.get("--dot")?.toLowerCase()).toBe("#ffc42e");
  });

  it("los dos bloques del tema oscuro dicen exactamente lo mismo", () => {
    // El patrón de tres estados obliga a escribir el oscuro dos veces (por
    // preferencia del sistema y por elección explícita). Si se separan, quien
    // eligió «oscuro» a mano ve otro sitio que quien lo trae del sistema.
    const bySystem = declarations(blockOf(css, ':root:not([data-theme="light"])'));
    const byChoice = declarations(blockOf(css, ':root[data-theme="dark"]'));
    expect(bySystem.size).toBeGreaterThan(0);
    expect([...byChoice]).toEqual([...bySystem]);
  });

  it("el oscuro no toca la marca: ni el punto ni el texto sobre azul", () => {
    const dark = declarations(blockOf(css, ':root[data-theme="dark"]'));
    for (const token of ["--dot", "--on-dot", "--on-blue", "--on-blue-muted"]) {
      expect(dark.has(token), `${token} no cambia entre temas`).toBe(false);
    }
  });

  it("el espejo en TypeScript coincide con el token", () => {
    const light = declarations(blockOf(css, ":root {"));
    expect(BRAND_BLUE.toLowerCase()).toBe(light.get("--blue")?.toLowerCase());
  });
});

describe("barrera: ningún color escrito a mano fuera de los tokens", () => {
  it("src/ no tiene colores literales", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const name = relative(SRC, file);
      // Los SVG de la marca SON la marca: llevan sus colores dentro.
      if (ALLOWED.has(name) || name.startsWith("assets/brand/")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(COLOR_LITERAL)) {
          offenders.push(`${name}:${index + 1} → ${match[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("la barrera sí reconoce un color cuando lo ve", () => {
    const hits = (text: string) => [...text.matchAll(COLOR_LITERAL)].map((m) => m[0]);
    expect(hits("color: #FFC42E;")).toEqual(["#FFC42E"]);
    expect(hits("border: 1px solid rgba(13,18,51,.14)")).toEqual(["rgba("]);
    expect(hits("background: oklch(60% 0.2 260)")).toEqual(["oklch("]);
    expect(hits('<a href="#beneficios">')).toEqual([]);
    expect(hits('<a href="#faq">')).toEqual([]);
  });
});
