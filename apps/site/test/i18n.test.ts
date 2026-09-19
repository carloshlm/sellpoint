import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LANGUAGES, ROUTES } from "../src/config/markets";
import { getMessages, LOCALE_MESSAGES, ROUTE_OVERRIDES } from "../src/i18n";

// F11-SITE-BASE-04 — la misma ley que `apps/web`: a ningún idioma le puede
// faltar una clave. El español es el maestro; los demás se comparan con él.

/** Las claves de un objeto, aplanadas: `nav.cta`, `hero.headline`… */
function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** Las hojas de texto de un objeto (las de un arreglo, una por una). */
function leavesOf(value: unknown, prefix = ""): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leavesOf(v, `${prefix}[${i}]`));
  if (typeof value !== "object" || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    leavesOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("textos del sitio", () => {
  const master = keysOf(LOCALE_MESSAGES.es).sort();

  it("hay un archivo por cada idioma de la matriz", () => {
    expect(Object.keys(LOCALE_MESSAGES).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES.filter((language) => language !== "es"))(
    "%s tiene exactamente las claves del español",
    (language) => {
      const keys = keysOf(LOCALE_MESSAGES[language]).sort();
      expect(
        master.filter((key) => !keys.includes(key)),
        "faltan",
      ).toEqual([]);
      expect(
        keys.filter((key) => !master.includes(key)),
        "sobran",
      ).toEqual([]);
    },
  );

  it("ningún texto está vacío, en ningún idioma", () => {
    for (const language of LANGUAGES) {
      for (const [key, value] of leavesOf(LOCALE_MESSAGES[language])) {
        expect(typeof value, `${language}:${key}`).toBe("string");
        expect((value as string).trim(), `${language}:${key}`).not.toBe("");
      }
    }
  });

  it("los ajustes por ruta solo pisan claves que existen", () => {
    // Un ajuste con la clave mal escrita no falla: simplemente nunca se ve.
    for (const [route, overrides] of Object.entries(ROUTE_OVERRIDES)) {
      expect(ROUTES).toContain(route);
      for (const key of keysOf(overrides)) expect(master, `${route}:${key}`).toContain(key);
    }
  });

  it("cada ruta recibe sus textos completos, con sus ajustes encima", () => {
    for (const route of ROUTES) {
      expect(keysOf(getMessages(route)).sort(), route).toEqual(master);
    }
    // Canadá escribe «catalogue»; Estados Unidos, «catalog» (§7.5).
    expect(getMessages("en-ca").meta.description).not.toBe(getMessages("en-us").meta.description);
    // Los ajustes no se filtran al idioma base.
    expect(getMessages("en-us").meta.description).toBe(LOCALE_MESSAGES.en.meta.description);
  });

  it("ningún espacio invisible va escrito a pelo en el código: siempre con su código", () => {
    // Un U+202F o un U+00A0 tecleado no se distingue de un espacio normal en
    // el editor, y el primero que «limpie» el archivo lo rompe sin enterarse.
    const dir = fileURLToPath(new URL("../src/i18n", import.meta.url));
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((file) =>
      file.endsWith(".ts"),
    );
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/[\u00a0\u202f\u2009]/);
    }
  });

  it("el francés lleva espacio de no separación antes de ? ! : ; y dentro de « »", () => {
    // Con un espacio normal, el signo puede quedar solo al inicio de un renglón.
    for (const [key, value] of leavesOf(LOCALE_MESSAGES.fr)) {
      const text = value as string;
      expect(text, key).not.toMatch(/ [?!:;»]/);
      expect(text, key).not.toMatch(/« /);
      expect(text, key).not.toMatch(/[^\s  ][?!;]/);
    }
  });
});
