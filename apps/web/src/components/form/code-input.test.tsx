import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: todo input de CÓDIGO de catálogo normaliza AL TECLEAR
 * (F9-SUPPCAT-01, Carlos 2026-09-12: «solo mayúsculas»).
 *
 * El API ya normaliza —esa es la garantía de los datos— pero si la pantalla
 * no lo hace, la persona escribe `abc`, guarda, y al recargar aparece `ABC`:
 * un cambio que no pidió. Lo que se escribe tiene que ser lo que se guarda.
 *
 * Es test de FUENTE, como el del lote: lo que se protege es que CADA input de
 * código use el normalizador compartido. La lista es explícita porque
 * `setCode(` también existe en pantallas que no son un código de catálogo.
 */
const SRC = join(__dirname, "..", "..");

const INPUTS_DE_CODIGO = [
  ["routes/catalog.products.tsx", "setSku("],
  ["routes/catalog.services.tsx", "setCode("],
  ["routes/warehouses.tsx", "setCode("],
  ["routes/catalog.lists.tsx", "setCode("],
  ["components/medical-clinic/study-form.tsx", "setCode("],
  ["components/suppliers/supplier-form.tsx", "setCode("],
] as const;

describe("el código de catálogo se normaliza al teclear", () => {
  it("los seis inputs existen (la barrera no se salta por un barrido vacío)", () => {
    for (const [ruta, setter] of INPUTS_DE_CODIGO) {
      expect(readFileSync(join(SRC, ruta), "utf8")).toContain(setter);
    }
  });

  it("cada input de código envuelve el valor con `normalizeCode`", () => {
    const infractores = INPUTS_DE_CODIGO.filter(([ruta, setter]) => {
      const fuente = readFileSync(join(SRC, ruta), "utf8");
      const crudo = new RegExp(`${setter.replace("(", "\\(")}\\s*event\\.target\\.value\\s*\\)`);
      return crudo.test(fuente) || !fuente.includes("normalizeCode(");
    }).map(([ruta]) => ruta);
    expect({ sinNormalizar: infractores }).toEqual({ sinNormalizar: [] });
  });
});
