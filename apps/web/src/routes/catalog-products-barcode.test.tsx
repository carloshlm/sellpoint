import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: el código de barras se captura EN EL ALTA (2026-08-24).
 *
 * Carlos: «no me gusta que se tenga que hacer dos pasos para dar de alta un
 * producto y asignarle un código de barras después». Tiene razón, y el camino
 * ya existía: `price` y `cost` viajan en el formulario del PRODUCTO y el API
 * los escribe en la presentación BASE. El código de barras es el mismo caso.
 *
 * Test de FUENTE porque lo que se protege es el CABLEADO completo — que el
 * campo exista, que su valor entre al payload, y que al editar se lea de la
 * presentación base. Un campo que se pinta pero no viaja es peor que no
 * tenerlo: el usuario cree que guardó.
 */
const FORMULARIO = join(__dirname, "catalog.products.tsx");

const fuente = (): string => readFileSync(FORMULARIO, "utf8");

describe("código de barras en el formulario de producto", () => {
  it("el formulario tiene su campo", () => {
    expect(fuente()).toContain("products.form.barcode");
  });

  it("el valor VIAJA en el payload, no se queda en la pantalla", () => {
    // Sin esta línea el campo sería decorativo y el usuario creería que guardó.
    expect(fuente()).toMatch(/barcode !== ""[^\n]*\{ barcode \}/);
  });

  it("al editar, se lee de la presentación BASE (donde vive de verdad)", () => {
    // Mismo origen que el precio: `barcode` no es columna de `products`.
    expect(fuente()).toMatch(/useState\(basePresentation\?\.barcode/);
  });

  /**
   * ── EL ORDEN ES CONTRATO (2026-08-24, decisión de Carlos) ─────────────
   *
   * «Los quiero en ese orden»: código de barras, código interno, nombre,
   * unidad base, costo, precio. No es capricho — sigue el flujo de quien da
   * de alta un producto con la caja en la mano: primero lo que viene impreso
   * en el empaque, después lo que decide el negocio. Y **costo antes que
   * precio** porque el precio se decide MIRANDO el costo, no al revés.
   *
   * Se fija como test porque un reordenamiento accidental no rompe nada
   * visible: el formulario sigue funcionando, solo deja de acompañar al
   * usuario.
   */
  it("los campos van en el orden que acompaña al alta", () => {
    const codigo = fuente();
    // Se busca la ETIQUETA completa y no el prefijo de la clave: `products.
    // form.cost` también casa con `products.form.costHint`, y una contraprueba
    // que renombraba la etiqueta seguía encontrando el hint al lado — el test
    // pasaba con el orden roto. Medir el prefijo es medir al vecino.
    const posicion = (clave: string) => {
      const indice = codigo.indexOf(`label={t("products.form.${clave}")}`);
      if (indice === -1) {
        throw new Error(`el formulario no tiene el campo ${clave}`);
      }
      return indice;
    };

    const esperado = ["barcode", "sku", "name", "baseUnit", "cost", "price"];
    const enOrden = [...esperado].sort((a, b) => posicion(a) - posicion(b));

    expect(enOrden).toEqual(esperado);
  });

  it("cada campo explica PARA QUÉ es, no solo cómo se llama", () => {
    const codigo = fuente();

    // Sin la pista, «Código» y «Código de barras» se confunden, y «Costo» y
    // «Precio» se invierten. El nombre solo no alcanza.
    for (const clave of ["barcodeHint", "skuHint", "costHint", "priceHint"]) {
      expect(codigo).toContain(`products.form.${clave}`);
    }
  });

  it("la barrera mira el archivo correcto (no un barrido vacío)", () => {
    // Sin esto, mover el formulario dejaría los tests de arriba pasando por
    // leer un archivo que ya no es el que importa.
    const codigo = fuente();
    expect(codigo).toContain("products.form.price");
    expect(codigo).toContain("basePresentation");
  });
});
