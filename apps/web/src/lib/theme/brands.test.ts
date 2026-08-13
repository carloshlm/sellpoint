import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyBrand } from "./apply-brand";
import { BRAND_IDS, BRAND_LIST, BRANDS, DEFAULT_BRAND, resolveBrand } from "./brands";

const css = readFileSync(join(__dirname, "../../index.css"), "utf-8");

describe("catálogo de marcas", () => {
  it("expone cada marca declarada, con el id coincidiendo con su clave", () => {
    expect(BRAND_LIST).toHaveLength(BRAND_IDS.length);
    for (const id of BRAND_IDS) {
      expect(BRANDS[id].id).toBe(id);
    }
  });

  it("el default es una marca real del catálogo", () => {
    expect(BRAND_IDS).toContain(DEFAULT_BRAND);
  });

  it("cada marca trae sus claves i18n y sus 3 muestras para el selector", () => {
    for (const brand of BRAND_LIST) {
      expect(brand.nameKey).toMatch(/^theme\.brands\./);
      expect(brand.descriptionKey).toMatch(/^theme\.brands\./);
      expect(brand.swatch).toHaveLength(3);
      for (const color of brand.swatch) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

/**
 * GUARDARRAÍL DEL SISTEMA DE TEMAS: el catálogo TS y los tokens CSS son dos
 * archivos que tienen que moverse juntos. Sin este test, agregar una marca
 * al catálogo y olvidar su bloque CSS produce una app SIN COLORES para el
 * tenant que la elija — un bug que no aparece en dev (donde nadie la usa) y
 * explota en producción con un cliente real. Acá falla en CI.
 */
describe("sincronía entre el catálogo y los tokens CSS", () => {
  it.each(BRAND_IDS)("la marca '%s' define su bloque de tokens claro", (id) => {
    const selector =
      id === DEFAULT_BRAND
        ? new RegExp(`(:root,\\s*)?\\[data-brand="${id}"\\]\\s*\\{`)
        : new RegExp(`\\[data-brand="${id}"\\]\\s*\\{`);
    expect(css).toMatch(selector);
  });

  it.each(BRAND_IDS)("la marca '%s' define su bloque de tokens oscuro", (id) => {
    expect(css).toMatch(new RegExp(`\\[data-brand="${id}"\\]\\.dark\\s*\\{`));
  });

  it.each(BRAND_IDS)("la marca '%s' define los tokens mínimos para no verse rota", (id) => {
    // Un bloque vacío pasaría el test de existencia pero dejaría la app sin
    // fondo ni texto: exigimos los tokens estructurales de shadcn.
    const block = css.match(new RegExp(`\\[data-brand="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    for (const token of ["--background", "--foreground", "--primary", "--border", "--radius"]) {
      expect(block).toContain(token);
    }
  });

  it("los tokens semánticos NO se redefinen por marca: alerta y error son universales", () => {
    // Que un tenant elija su marca no puede volver indistinguible un error
    // de un éxito. Estos viven fuera de los bloques [data-brand].
    for (const id of BRAND_IDS) {
      const block = css.match(new RegExp(`\\[data-brand="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(block).not.toContain("--success:");
      expect(block).not.toContain("--warning:");
    }
    expect(css).toMatch(/:root\s*\{[^}]*--success:/);
  });
});

describe("resolveBrand", () => {
  it("acepta las marcas válidas", () => {
    for (const id of BRAND_IDS) {
      expect(resolveBrand(id)).toBe(id);
    }
  });

  it.each([undefined, null, "", "no-existe", 42, {}])(
    "cae al default ante un valor inválido (%s)",
    (value) => {
      expect(resolveBrand(value)).toBe(DEFAULT_BRAND);
    },
  );
});

describe("applyBrand", () => {
  it("escribe data-brand en el documento", () => {
    applyBrand("menta");
    expect(document.documentElement.dataset.brand).toBe("menta");
  });

  it("una marca inválida guardada en la config del tenant no rompe la app: cae al default", () => {
    applyBrand("marca-borrada-del-catalogo" as never);
    expect(document.documentElement.dataset.brand).toBe(DEFAULT_BRAND);
  });

  it("sin argumento aplica el default", () => {
    applyBrand("teal");
    expect(applyBrand()).toBe(DEFAULT_BRAND);
    expect(document.documentElement.dataset.brand).toBe(DEFAULT_BRAND);
  });
});
