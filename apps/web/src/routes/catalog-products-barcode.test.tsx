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

  /**
   * Los dos interruptores van AL FINAL, y en este orden (Carlos, 2026-08-24):
   * lote y caducidad primero, «se arma a partir de otros productos» después.
   *
   * El criterio: los campos de arriba son DATOS del producto —lo que dice la
   * caja, lo que cobra el negocio— y estos dos son decisiones de
   * COMPORTAMIENTO que cambian cómo se maneja el producto en todo el sistema.
   * Mezclarlos entre la descripción y el proveedor los volvía fáciles de
   * pasar por alto, justo los dos que más consecuencias tienen.
   */
  it("los dos interruptores son lo ÚLTIMO antes de Guardar", () => {
    const codigo = fuente();

    const lotes = codigo.indexOf('id="tracks-lots"');
    const compuesto = codigo.indexOf('id="is-composite"');
    const camposPropios = codigo.indexOf("<DynamicForm");
    const guardar = codigo.indexOf('type="submit"');

    // Primero lote y caducidad; después «se arma a partir de otros».
    expect(lotes).toBeLessThan(compuesto);
    // Los dos DESPUÉS de los campos personalizados del negocio…
    expect(camposPropios).toBeLessThan(lotes);
    // …y los dos ANTES del botón, sin nada en medio.
    expect(compuesto).toBeLessThan(guardar);
  });

  it("cada campo explica PARA QUÉ es, no solo cómo se llama", () => {
    const codigo = fuente();

    // Sin la pista, «Código» y «Código de barras» se confunden, y «Costo» y
    // «Precio» se invierten. El nombre solo no alcanza.
    for (const clave of ["barcodeHint", "skuHint", "costHint", "priceHint"]) {
      expect(codigo).toContain(`products.form.${clave}`);
    }
  });

  /**
   * El MISMO formulario con dos fondos era el problema (Carlos, 2026-08-24):
   * el alta salía en tarjeta blanca y la pestaña «Información» pelada sobre
   * el gris de la página. Un formulario que se ve distinto según de dónde se
   * llegue parece OTRO formulario — y el usuario duda de si hace lo mismo.
   */
  it("la pestaña Información envuelve el formulario en la MISMA tarjeta que el alta", () => {
    const codigo = fuente();
    const inicio = codigo.indexOf('tab === "info"');
    // El fin se busca DESDE el inicio: la primera aparición de
    // `PresentationsTab` es el import de arriba del archivo, y cortar hasta
    // ahí devolvía un tramo VACÍO que fallaba sin decir por qué.
    const pestania = codigo.slice(inicio, codigo.indexOf("PresentationsTab", inicio));

    expect(pestania.length).toBeGreaterThan(0);
    expect(pestania).toContain("<Card");
    expect(pestania).toContain("<ProductForm");
  });

  it("la barrera mira el archivo correcto (no un barrido vacío)", () => {
    // Sin esto, mover el formulario dejaría los tests de arriba pasando por
    // leer un archivo que ya no es el que importa.
    const codigo = fuente();
    expect(codigo).toContain("products.form.price");
    expect(codigo).toContain("basePresentation");
  });
});
