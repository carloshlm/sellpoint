import fs from "node:fs";
import path from "node:path";
import { SUPPORTED_LOCALES } from "@sellpoint/shared";

/**
 * Guardián de las claves de error.
 *
 * Un `throw new BadRequestException({ message: "catalogs.field_required" })` sin
 * su entrada en los JSON no rompe NADA: el filtro devuelve la clave cruda, los
 * tests pasan y el usuario ve `catalogs.field_required` en la pantalla. Pasó
 * tres veces seguidas —`products.composition_cycle`, `products.too_many_decimals`
 * y el `catalogs.field_required` que Carlos fotografió— y las tres se
 * descubrieron mirando la app, que es la peor forma de descubrirlas.
 *
 * Este test cierra ese hueco: cada clave que el código EMITE tiene que existir
 * en TODOS los idiomas. Es la única verificación posible, porque el compilador
 * no sabe que ese string es una clave.
 */

const SRC = path.join(__dirname, "..");
const I18N = __dirname;

/**
 * Los DOS canales por los que una clave llega a una respuesta de error:
 *
 * 1. `message: "dominio.clave"` — el throw directo.
 * 2. El `fallbackKey` de `ZodValidationPipe`, que viaja como ARGUMENTO del
 *    constructor. La primera versión de este guardián solo miraba el canal 1 y
 *    por eso dejó pasar `products.invalid_body`, que Carlos vio en pantalla.
 */
const KEY_PATTERNS = [
  /message:\s*"([a-z_]+\.[a-z_.]+)"/g,
  /ZodValidationPipe\([^)]*?"([a-z_]+\.[a-z_.]+)"/g,
];

/**
 * La usa `all-exceptions.filter.spec.ts` para probar justamente el caso de una
 * clave SIN traducción. Traducirla rompería ese test.
 */
const DELIBERATELY_UNTRANSLATED = new Set(["auth.some_key_without_translation"]);

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "generated" ? [] : collectSourceFiles(full);
    }
    // Los `.spec.ts` inventan claves para probar el filtro: no son contrato.
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

function emittedKeys(): string[] {
  const keys = new Set<string>();
  for (const file of collectSourceFiles(SRC)) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of KEY_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const key = match[1];
        if (key && !DELIBERATELY_UNTRANSLATED.has(key)) {
          keys.add(key);
        }
      }
    }
  }
  return [...keys].sort();
}

function flatten(value: unknown, prefix: string, into: Set<string>): void {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into);
    }
    return;
  }
  into.add(prefix);
}

function translatedKeys(locale: string): Set<string> {
  const dir = path.join(I18N, locale);
  const keys = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const namespace = file.replace(/\.json$/, "");
    flatten(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")), namespace, keys);
  }
  return keys;
}

describe("Claves de error traducidas", () => {
  const emitted = emittedKeys();

  it("encuentra las claves que emite el código (el escáner sirve para algo)", () => {
    // Un regex que dejara de matchear volvería este test verde por vacío, que
    // es la forma más silenciosa de perder una red de seguridad.
    expect(emitted.length).toBeGreaterThan(50);
    expect(emitted).toContain("catalogs.field_required");
    // Del canal 2: si el patrón del pipe se rompiera, este caso lo canta.
    expect(emitted).toContain("products.invalid_body");
  });

  it.each(SUPPORTED_LOCALES)("cada clave emitida existe en %s", (locale) => {
    const available = translatedKeys(locale);
    const missing = emitted.filter((key) => !available.has(key));

    // El mensaje del assert lista las que faltan: quien rompa esto tiene que
    // poder arreglarlo sin salir a buscar cuáles son.
    expect({ locale, missing }).toEqual({ locale, missing: [] });
  });
});
