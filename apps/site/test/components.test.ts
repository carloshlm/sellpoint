import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUTTON_VARIANTS, DOT_MARK_VARIANTS } from "../src/components/variants";

// F11-SITE-BASE-06 — los componentes del prototipo, uno por archivo y SIN texto
// dentro. Un texto escrito en un componente sale igual en los tres idiomas.
const COMPONENTS = fileURLToPath(new URL("../src/components", import.meta.url));
const read = (name: string) => readFileSync(join(COMPONENTS, name), "utf8");

/** Lo que un visitante podría LEER de un componente: su plantilla sin código. */
function visibleText(source: string): string {
  const withoutMarkup = source
    .replace(/^---[\s\S]*?^---/m, "") // el bloque de código de Astro
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // comentarios {/* … */}
    .replace(/<[^>]+>/g, " "); // las etiquetas, con sus atributos
  // Las expresiones {…} se quitan de adentro hacia afuera y hasta que no quede
  // ninguna: un `{items.map((item) => ({item.name}))}` anida llaves.
  let text = withoutMarkup;
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/\{[^{}]*\}/g, " ");
  }
  return text;
}

describe("componentes base", () => {
  it.each(["Button", "Eyebrow", "SectionHeading", "DotMark", "Container"])(
    "existe %s.astro",
    (name) => {
      expect(existsSync(join(COMPONENTS, `${name}.astro`))).toBe(true);
    },
  );

  it("ningún componente trae una cadena visible escrita dentro", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(COMPONENTS).filter((name) => name.endsWith(".astro"))) {
      const leftovers = visibleText(read(file)).match(/\p{L}[\p{L}\p{N}'’ ]*/gu) ?? [];
      for (const text of leftovers) offenders.push(`${file}: «${text.trim()}»`);
    }
    expect(offenders).toEqual([]);
  });

  it("tampoco en atributos que se leen en voz alta", () => {
    // `aria-label="Cerrar"` escrito a mano es un texto sin traducir que solo
    // oye quien usa lector de pantalla. Tiene que llegar como propiedad.
    for (const file of readdirSync(COMPONENTS).filter((name) => name.endsWith(".astro"))) {
      const template = read(file).replace(/^---[\s\S]*?^---/m, "");
      expect(template, file).not.toMatch(/\b(aria-label|title|alt|placeholder)="[^"]*\p{L}/u);
    }
  });

  it("el detector sí ve un texto cuando lo hay", () => {
    expect(visibleText("---\nconst a = 1;\n---\n<a href={x}>Empieza gratis</a>")).toMatch(
      /Empieza/,
    );
    expect(visibleText('---\n---\n<a class="btn" {...rest}><slot /></a>').trim()).toBe("");
    // Un .map() con marcado adentro no es texto visible. LÍMITE CONOCIDO: un
    // texto escrito DENTRO del .map() tampoco se ve, porque sin un parser de
    // JSX no hay forma de separarlo del código. Ese caso lo atrapa la revisión.
    expect(visibleText("---\n---\n{items.map((item) => (<li>{item.name}</li>))}").trim()).toBe("");
  });

  it("el botón tiene sus variantes y el punto sus cuatro (guía §4, §6 y §11)", () => {
    // Las tres del prototipo, más `outline`: el botón de los planes que no son
    // el recomendado, que la guía §11 pide con borde en tinta.
    expect([...BUTTON_VARIANTS]).toEqual(["dot", "ghost", "blue", "outline"]);
    expect([...DOT_MARK_VARIANTS]).toEqual(["full", "ring", "half", "sun"]);
    for (const variant of BUTTON_VARIANTS)
      expect(read("Button.astro")).toContain(`.btn--${variant}`);
    for (const variant of DOT_MARK_VARIANTS) {
      expect(read("DotMark.astro")).toContain(`.mark--${variant}`);
    }
  });
});
