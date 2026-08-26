import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyTheme } from "./apply-theme";
import {
  DEFAULT_THEME,
  resolveTheme,
  THEME_IDS,
  THEME_LIST,
  THEMES,
  WIZARD_THEME_IDS,
} from "./themes";

const SRC_DIR = join(__dirname, "../..");
const css = readFileSync(join(SRC_DIR, "index.css"), "utf-8");

describe("catálogo de temas", () => {
  it("expone cada tema declarado, con el id coincidiendo con su clave", () => {
    expect(THEME_LIST).toHaveLength(THEME_IDS.length);
    for (const id of THEME_IDS) {
      expect(THEMES[id].id).toBe(id);
    }
  });

  it("el default es un tema real del catálogo", () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME);
  });

  it("cada tema trae su clave i18n y su muestra para el selector", () => {
    for (const theme of THEME_LIST) {
      expect(theme.nameKey).toMatch(/^common\.theme\.names\./);
      expect(theme.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("los ids son EXACTAMENTE los del enum del API (update-tenant.dto.ts)", () => {
    // Si esto falla, el selector ofrece un tema que el PATCH rechaza con 400
    // — o el API acepta uno que la app no sabe pintar.
    expect([...THEME_IDS].sort()).toEqual([
      "cabin",
      "charcoal",
      "cotton",
      "dark",
      "emerald",
      "grape",
      "light",
      "sand",
    ]);
  });

  it("el wizard ofrece SOLO la primera tanda; el perfil, las dos", () => {
    // Elegir tema no debe volverse la parte larga del registro (Carlos,
    // 2026-08-26) — el paso 3 avisa que en Mi perfil hay más.
    expect([...WIZARD_THEME_IDS]).toEqual(["light", "dark", "sand", "grape"]);
    expect(THEME_IDS.length).toBeGreaterThan(WIZARD_THEME_IDS.length);
  });
});

/**
 * GUARDARRAÍL DEL SISTEMA DE TEMAS: el catálogo TS y los tokens CSS son dos
 * archivos que tienen que moverse juntos. Sin este test, agregar un tema
 * al catálogo y olvidar su bloque CSS produce una app SIN COLORES para el
 * tenant que lo elija — un bug que no aparece en dev (donde nadie lo usa) y
 * explota en producción con un cliente real. Acá falla en CI.
 */
describe("sincronía entre el catálogo y los tokens CSS", () => {
  const NON_DEFAULT = THEME_IDS.filter((id) => id !== DEFAULT_THEME);

  it("el tema default vive en :root — la app nunca aparece sin estilos", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--background:/);
  });

  it.each(NON_DEFAULT)("el tema '%s' define su bloque de tokens", (id) => {
    expect(css).toMatch(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{`));
  });

  it.each(NON_DEFAULT)("el tema '%s' define los tokens mínimos para no verse roto", (id) => {
    // Un bloque vacío pasaría el test de existencia pero dejaría la app sin
    // fondo ni texto: exigimos los tokens estructurales de shadcn — sidebar
    // incluido, que es donde vive la identidad del Bitono.
    const block =
      css.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    for (const token of [
      "--background",
      "--foreground",
      "--card",
      "--primary",
      "--muted-foreground",
      "--border",
      "--sidebar:",
      "--sidebar-accent:",
    ]) {
      expect(block).toContain(token);
    }
  });

  it("los tokens semánticos NO se redefinen por tema claro: alerta y error son universales", () => {
    // Que un tenant elija su tema no puede volver indistinguible un error de
    // un éxito. Los temas CLAROS usan los semánticos de :root; los oscuros
    // usan los de `.dark` — por eso `applyTheme` los acompaña con la clase.
    for (const id of ["sand", "grape", "emerald", "cotton"] as const) {
      const block =
        css.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(block).not.toContain("--success:");
      expect(block).not.toContain("--warning:");
    }
    expect(css).toMatch(/:root\s*\{[^}]*--success:/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--success:/);
  });
});

/**
 * S1 del verify de f1-web-auth. Una utilidad de la paleta cruda —prefijo de
 * color + tono numérico— es invisible para el sistema de temas:
 * `[data-theme="sand"]` repinta la app entera menos ese elemento, así que el
 * tenant que elija otro tema ve un parche del tema por defecto. No lo
 * agarra ningún test de componente —las clases CSS no se asertan— ni el
 * linter: solo se ve barriendo el código, que es lo que este test automatiza.
 *
 * Los hex SÍ están permitidos en `themes.ts`: ese es el catálogo, su lugar
 * correcto. Lo prohibido es la paleta de Tailwind en la UI.
 *
 * El patrón se ARMA por alternación a propósito: si estuviera escrito como
 * clase completa en cualquier parte del archivo, Tailwind la encontraría al
 * escanear y la emitiría al CSS servido —el propio guardarraíl metería el
 * color muerto en el bundle—. Por eso tampoco se nombra ninguna en la prosa.
 */
const PALETA_CRUDA_TAILWIND =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|decoration|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b/;

/**
 * Se barre TODO lo que Tailwind escanea, tests incluidos: el generador de CSS
 * no distingue producción de test, así que una clase nombrada en un archivo
 * `.test.*` termina igual en el CSS que se sirve. El único excluido es
 * `routeTree.gen.ts`, que es generado.
 */
function listarFuentesEscaneadas(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const ruta = join(dir, entry.name);
    if (entry.isDirectory()) return listarFuentesEscaneadas(ruta);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "routeTree.gen.ts") return [];
    return [ruta];
  });
}

describe("theming: ningún color crudo de la paleta de Tailwind", () => {
  const fuentes = listarFuentesEscaneadas(SRC_DIR);

  it("hay fuentes que revisar (si esto falla, el barrido no está mirando nada)", () => {
    expect(fuentes.length).toBeGreaterThan(20);
  });

  it("todo el color sale de tokens semánticos, nunca de la paleta", () => {
    const infractores = fuentes
      .map((ruta) => ({
        ruta: ruta.slice(SRC_DIR.length + 1),
        clase: readFileSync(ruta, "utf-8").match(PALETA_CRUDA_TAILWIND)?.[0],
      }))
      .filter((archivo) => archivo.clase !== undefined)
      .map((archivo) => `${archivo.ruta}: ${archivo.clase}`);

    expect(infractores).toEqual([]);
  });
});

describe("resolveTheme", () => {
  it("acepta los temas válidos", () => {
    for (const id of THEME_IDS) {
      expect(resolveTheme(id)).toBe(id);
    }
  });

  it.each([undefined, null, "", "no-existe", 42, {}])(
    "cae al default ante un valor inválido (%s)",
    (value) => {
      expect(resolveTheme(value)).toBe(DEFAULT_THEME);
    },
  );
});

describe("applyTheme", () => {
  it("un tema no-default escribe data-theme; los oscuros además encienden la clase dark", () => {
    applyTheme("sand");
    expect(document.documentElement.dataset.theme).toBe("sand");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Los TRES oscuros del catálogo (isDark), no solo el que se llama "dark".
    for (const oscuro of ["dark", "cabin", "charcoal"] as const) {
      applyTheme(oscuro);
      expect(document.documentElement.dataset.theme).toBe(oscuro);
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    }
  });

  it("el default LIMPIA el atributo y la clase: :root ya es la paleta clara", () => {
    applyTheme("grape");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("un tema inválido guardado en la config del tenant no rompe la app: cae al default", () => {
    applyTheme("tema-borrado-del-catalogo");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
