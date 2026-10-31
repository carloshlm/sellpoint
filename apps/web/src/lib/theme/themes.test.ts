import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyTheme } from "./apply-theme";
import {
  DEFAULT_THEME,
  ROOT_THEME,
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

  it("el default es SellPointy y el de :root sigue siendo Claro: son dos cosas distintas", () => {
    // Carlos, 2026-09-26: la marca desde el inicio de sesión, el registro y el
    // wizard. Claro no se mueve de :root: si el CSS no carga un bloque, la app
    // cae a la paleta clara completa, nunca a una sin estilos.
    expect(DEFAULT_THEME).toBe("sellpointy");
    expect(ROOT_THEME).toBe("light");
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
      "amethyst",
      "cabin",
      "cotton",
      "cotton-night",
      "dark",
      "espresso",
      "forest",
      "jade",
      "light",
      "marine",
      "sand",
      "sellpointy",
      "sellpointy-light",
      "sky",
      "violet",
    ]);
  });

  /**
   * Carlos (2026-10-30): el orden del selector. Primero Claro y Oscuro, luego
   * los dos de la marca, y Cabina al final.
   */
  it("el perfil los ofrece en el orden que pidió Carlos", () => {
    expect([...THEME_IDS]).toEqual([
      "light",
      "dark",
      "sellpointy",
      "sellpointy-light",
      "sand",
      "espresso",
      "jade",
      "forest",
      "cotton",
      "cotton-night",
      "violet",
      "amethyst",
      "sky",
      "marine",
      "cabin",
    ]);
  });

  it("el wizard ofrece SOLO la primera tanda, en su orden; el perfil, todas", () => {
    // Elegir tema no debe volverse la parte larga del registro (Carlos,
    // 2026-08-26) — el paso 3 avisa que en Mi perfil hay más. Desde el
    // 2026-09-26 abre con el de la marca y Algodón toma el lugar de Uva.
    expect([...WIZARD_THEME_IDS]).toEqual(["sellpointy", "light", "dark", "sand", "cotton"]);
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
  const NON_ROOT = THEME_IDS.filter((id) => id !== ROOT_THEME);

  it("el tema raíz (Claro) vive en :root — la app nunca aparece sin estilos", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--background:/);
  });

  it.each(NON_ROOT)("el tema '%s' define su bloque de tokens", (id) => {
    expect(css).toMatch(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{`));
  });

  it.each(NON_ROOT)("el tema '%s' define los tokens mínimos para no verse roto", (id) => {
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
      // El color de los títulos de sección del menú: sin él, un menú oscuro
      // los pinta con el gris del contenido y no se leen (2026-09-26).
      "--sidebar-section:",
    ]) {
      expect(block).toContain(token);
    }
  });

  it("el tema raíz también define el color de los títulos del menú", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--sidebar-section:/);
  });

  it("los tokens semánticos NO se redefinen por tema claro: alerta y error son universales", () => {
    // Que un tenant elija su tema no puede volver indistinguible un error de
    // un éxito. Los temas CLAROS usan los semánticos de :root; los oscuros
    // usan los de `.dark` — por eso `applyTheme` los acompaña con la clase.
    for (const id of [
      "sellpointy-light",
      "sand",
      "espresso",
      "jade",
      "forest",
      "cotton",
      "violet",
      "sky",
      "marine",
    ] as const) {
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

/**
 * F10-THEME-05 — la PIEL por componente. Un tema marcado `skinned` no solo
 * cambia colores: viste cada tipo de elemento (menú, tarjetas, botones,
 * campos, tablas, badges…) con las reglas de `.skinned` en `index.css`, que
 * leen tokens `--skin-*` del bloque del tema. Si un tema con piel olvida uno,
 * esa regla queda con un valor vacío y el elemento se ve roto — en ese tema
 * nada más, que es justo el que nadie mira en desarrollo.
 */
/** El bloque CSS de un tema. Claro vive en `:root` a secas (en más de un bloque). */
function bloqueDelTema(id: string): string {
  if (id === ROOT_THEME) {
    return [...css.matchAll(/(?:^|\n):root\s*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  }
  return css.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("la piel por componente (temas skinned)", () => {
  const SKINNED = THEME_IDS.filter((id) => THEMES[id].skinned === true);
  const tokensDeLaPiel = [
    ...new Set([...css.matchAll(/var\((--skin-[a-z0-9-]+)\)/g)].map((m) => m[1] as string)),
  ];

  it("todos los temas tienen piel, claros y oscuros", () => {
    // Carlos, 2026-10-22: Arena, Algodón, Cabina y SellPointy se reemplazaron
    // por su versión con piel (mismo id); Claro y Oscuro tomaron el estilo de
    // Niebla Cobalto y Grafito Líquido; se sumaron Café Expreso, Esmeralda
    // Jade y Esmeralda Bosque, y se retiraron Uva, Esmeralda y Carbón.
    expect(SKINNED).toEqual([...THEME_IDS]);
    // Carlos, 2026-10-24: se sumaron Algodón Noche, Violeta, Amatista, Cielo y
    // Marino, y Algodón tomó el rosa chicle.
    // Carlos, 2026-10-30: el orden nuevo del selector; SellPointy Claro es claro.
    expect(SKINNED.filter((id) => THEMES[id].isDark)).toEqual([
      "dark",
      "sellpointy",
      "cotton-night",
      "amethyst",
      "cabin",
    ]);
  });

  it("el tema de la marca no usa amarillo para advertir: el amarillo es el punto", () => {
    // SITIO-WEB-DISENO.md §2: el amarillo es escaso y es la marca. Si la
    // advertencia también fuera amarilla, «stock bajo» se leería como marca.
    const block = css.match(/:root\[data-theme="sellpointy"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/--skin-title-dot:\s*#ffc42e/);
    expect(block).toMatch(/--warning:\s*#ffa057/);
  });

  /**
   * Carlos (2026-10-30): «SellPointy Claro» es el menú de SellPointy Clásico
   * con todo lo demás de Claro. Las fichas del menú se comparan con las de la
   * marca y las de la página con las de Claro: si alguien retoca uno de los
   * dos, este tema no se queda a medias sin que nadie lo note.
   */
  it("SellPointy Claro lleva el menú de SellPointy y lo demás de Claro", () => {
    const valor = (bloque: string, token: string) =>
      bloque.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim();
    const marca = bloqueDelTema("sellpointy");
    const claro = bloqueDelTema("light");
    const nuevo = bloqueDelTema("sellpointy-light");

    for (const token of [
      "--sidebar",
      "--sidebar-foreground",
      "--sidebar-section",
      "--skin-sidebar-bg",
      "--skin-sidebar-line",
      "--skin-nav-hover-bg",
      "--skin-nav-active-bg",
      "--skin-nav-active-color",
      "--skin-nav-item-radius",
      "--skin-label-tracking",
    ]) {
      expect([token, valor(nuevo, token)]).toEqual([token, valor(marca, token)]);
    }
    for (const token of [
      "--background",
      "--card",
      "--primary",
      "--skin-glass",
      "--skin-title-dot-display",
      "--skin-button-radius",
      "--app-font-sans",
    ]) {
      expect([token, valor(nuevo, token)]).toEqual([token, valor(claro, token)]);
    }
    expect(nuevo).toContain("color-scheme: light");
    expect(THEMES["sellpointy-light"].isDark).toBe(false);
  });

  it("la piel lee tokens: si esto falla, el barrido no está mirando nada", () => {
    expect(tokensDeLaPiel.length).toBeGreaterThan(10);
  });

  it.each(SKINNED)("el tema '%s' define TODOS los tokens que la piel lee", (id) => {
    const block = bloqueDelTema(id);
    const faltan = tokensDeLaPiel.filter((token) => !block.includes(`${token}:`));
    expect(faltan).toEqual([]);
  });

  it.each(SKINNED)("el tema '%s' trae sus propias letras", (id) => {
    // Las letras son tokens que `font-sans` y `font-mono` leen. Claro las
    // define en `:root` y cualquier otro tema que no las traiga heredaría
    // las suyas sin que nadie lo decidiera.
    const block = bloqueDelTema(id);
    expect(block).toContain("--app-font-sans:");
    expect(block).toContain("--app-font-mono:");
    expect(css).toMatch(/--font-sans:\s*var\(--app-font-sans\)/);
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
    for (const oscuro of ["dark", "cabin", "sellpointy"] as const) {
      applyTheme(oscuro);
      expect(document.documentElement.dataset.theme).toBe(oscuro);
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    }
  });

  it("Oscuro enciende la piel y el oscuro: es el estilo de Grafito Líquido", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("skinned")).toBe(true);
  });

  it("Claro LIMPIA el atributo y el oscuro, pero lleva piel: es el estilo de Niebla Cobalto", () => {
    applyTheme("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("skinned")).toBe(true);
  });

  it("sin tema (antes de iniciar sesión) aplica el default: SellPointy, oscuro y con piel", () => {
    // Desde el 2026-10-22 la marca es oscura («Punto Azul»): el inicio de
    // sesión, el registro y el wizard ya se ven así.
    applyTheme("light");
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe("sellpointy");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("skinned")).toBe(true);
  });

  it("un tema inválido guardado en la config del tenant no rompe la app: cae al default", () => {
    applyTheme("tema-borrado-del-catalogo");
    expect(document.documentElement.dataset.theme).toBe("sellpointy");
  });
});
