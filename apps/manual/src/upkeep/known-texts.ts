import ts from "typescript";
import type { Finding, ScreenFacts } from "./screen-source.js";

/**
 * LOS TEXTOS QUE EXISTEN: contra esto se revisa lo que buscan las capturas.
 * Un texto de la pantalla sale de las traducciones en español (del web, o del
 * API cuando lo manda él: un mensaje, un PDF) o de los datos de la tienda de
 * ejemplo (`seed.ts`, `demo.ts`).
 */

export interface Message {
  /** `common.layout.nav.suppliers`, o `products.json › form.name` sin el archivo. */
  key: string;
  value: string;
}

/** Cada texto de un JSON de traducciones, con su clave de puntos. */
export function flattenMessages(value: unknown, prefix = ""): Message[] {
  const key = (part: string) => (prefix === "" ? part : `${prefix}.${part}`);
  if (typeof value === "string") return [{ key: prefix, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenMessages(item, key(String(index))));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([name, item]) => flattenMessages(item, key(name)));
  }
  return [];
}

/**
 * Los DATOS de la demo: las cadenas que son valor de una propiedad
 * (`name: "Sucursal Norte"`) o elemento de un arreglo (`["P1", "Bebidas"]`).
 * Quedan fuera los mensajes de consola, las rutas del API y el SQL, que nunca
 * salen en pantalla.
 */
export function demoLiterals(source: string): string[] {
  const file = ts.createSourceFile("demo.ts", source, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) && node.text.trim() !== "") {
      const parent = node.parent;
      if (
        (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
        ts.isArrayLiteralExpression(parent)
      ) {
        found.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `{{x}}` de i18next (web) y `{x}` de nestjs-i18n (API). */
const PLACEHOLDER = /\{\{[^{}]*\}\}|\{[^{}]*\}/g;
/** Lo que la pantalla pone entre un texto y un dato: «Lista de otro catálogo → Pasillos». */
const JOINERS = new Set(["→", "·", "—", "–", "-", ":", "|", "/", "›", "»"]);

interface Pattern {
  exact: RegExp;
  loose: RegExp;
}

export interface TextIndex {
  /**
   * ¿Existe el texto? `exact` como en Playwright: completo y con sus
   * mayúsculas; si no, basta con que sea parte de un texto, sin importar
   * mayúsculas.
   */
  has(text: string, exact: boolean): boolean;
}

/**
 * `app`: los valores de las traducciones; una interpolación acepta cualquier
 * valor, pero solo si el texto la rodea igual. `demo`: los datos de la tienda
 * de ejemplo. Un texto también existe si se arma con datos de la demo y, a
 * lo más, UN texto de la app, unidos por espacios o por →, ·, —, : (así
 * «Luis Ramírez» o «Lista de otro catálogo → Pasillos»). Dos textos de la app
 * pegados no cuentan: «Nuevo» y «producto» existen solos, y «Nuevo producto»
 * podría haberse borrado.
 */
export function createTextIndex(sources: {
  app: readonly string[];
  demo: readonly string[];
}): TextIndex {
  const appWhole = new Set<string>();
  const appWholeLower = new Set<string>();
  const appStaticsLower: string[] = [];
  const patterns: Pattern[] = [];
  for (const raw of sources.app) {
    const value = normalize(raw);
    const statics = value.split(PLACEHOLDER);
    if (statics.length === 1) {
      appWhole.add(value);
      appWholeLower.add(value.toLowerCase());
      appStaticsLower.push(value.toLowerCase());
      continue;
    }
    appStaticsLower.push(...statics.map((part) => part.toLowerCase()));
    // Un valor que es casi pura interpolación («{{name}}») empataría con todo.
    if (statics.join("").replace(/[^\p{L}]/gu, "").length < 2) continue;
    const source = `^${statics.map(escapeRegex).join(".+?")}$`;
    patterns.push({ exact: new RegExp(source, "u"), loose: new RegExp(source, "iu") });
  }
  const demoWhole = new Set(sources.demo.map(normalize));
  const demoWholeLower = new Set([...demoWhole].map((text) => text.toLowerCase()));
  const demoLower = [...demoWholeLower];

  const isApp = (piece: string, exact: boolean) =>
    exact
      ? appWhole.has(piece) || patterns.some((p) => p.exact.test(piece))
      : appWholeLower.has(piece.toLowerCase()) || patterns.some((p) => p.loose.test(piece));
  const isDemo = (piece: string, exact: boolean) =>
    exact ? demoWhole.has(piece) : demoWholeLower.has(piece.toLowerCase());

  /** ¿Se arma con piezas: datos de la demo, uniones y a lo más un texto de la app? */
  const composed = (text: string, exact: boolean) => {
    const tokens = text.split(" ");
    // Estado: [posición, ya usó un texto de la app, ya tiene algo que no es unión].
    const seen = new Set<string>();
    const pending: [number, boolean, boolean][] = [[0, false, false]];
    while (pending.length > 0) {
      const [start, usedApp, hasContent] = pending.pop() as [number, boolean, boolean];
      if (start === tokens.length) {
        if (hasContent) return true;
        continue;
      }
      for (let end = start + 1; end <= tokens.length; end += 1) {
        const piece = tokens.slice(start, end).join(" ");
        const next: [number, boolean, boolean][] = [];
        if (JOINERS.has(piece)) next.push([end, usedApp, hasContent]);
        if (isDemo(piece, exact)) next.push([end, usedApp, true]);
        if (!usedApp && isApp(piece, exact)) next.push([end, true, true]);
        for (const state of next) {
          const key = state.join(":");
          if (!seen.has(key)) {
            seen.add(key);
            pending.push(state);
          }
        }
      }
    }
    return false;
  };

  return {
    has(raw, exact) {
      const text = normalize(raw);
      if (text === "") return false;
      if (exact) {
        if (appWhole.has(text) || demoWhole.has(text)) return true;
        if (patterns.some((pattern) => pattern.exact.test(text))) return true;
      } else {
        const lower = text.toLowerCase();
        if (appStaticsLower.some((part) => part.includes(lower))) return true;
        if (demoLower.some((part) => part.includes(lower))) return true;
        if (patterns.some((pattern) => pattern.loose.test(text))) return true;
      }
      return composed(text, exact);
    },
  };
}

/**
 * Los textos que buscan las capturas y que no existen. Cada uno se revisa en
 * el idioma de las capturas que lo usan (`locale` de la captura; todas, si
 * lo usan varias), y en español si no lo usa ninguna: el acceso de
 * `capture.ts`. Los de `exceptions` no se revisan.
 */
export function missingTexts(
  findings: readonly Finding[],
  screens: readonly ScreenFacts[],
  localeOf: (screenId: string) => string,
  indexes: Record<string, TextIndex>,
  exceptions: Readonly<Record<string, unknown>>,
): Finding[] {
  return findings.filter((finding) => {
    if (finding.kind !== "text" || finding.value in exceptions) return false;
    const locales = new Set(
      screens
        .filter((screen) => screen.findings.includes(finding))
        .map((screen) => localeOf(screen.id)),
    );
    if (locales.size === 0) locales.add("es");
    return [...locales].some((locale) => !indexes[locale]?.has(finding.value, finding.exact));
  });
}

export interface CodeIndex {
  /** ¿El código del web escribe este id entre comillas (o lo arma con un template que empieza igual)? */
  has(value: string): boolean;
}

/** Los ids y `data-testid` que existen: cualquier cadena entre comillas del código del web. */
export function createCodeIndex(sources: readonly string[]): CodeIndex {
  const text = sources.join("\n");
  const prefixes = [...text.matchAll(/`([^`$\\]*)\$\{/g)]
    .map((match) => match[1] as string)
    .filter((prefix) => prefix.length >= 3);
  return {
    has(value) {
      if (value === "") return false;
      if (['"', "'", "`"].some((quote) => text.includes(`${quote}${value}${quote}`))) return true;
      return prefixes.some((prefix) => value.startsWith(prefix) && value.length > prefix.length);
    },
  };
}
