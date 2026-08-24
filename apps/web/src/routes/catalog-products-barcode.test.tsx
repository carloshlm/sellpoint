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

  it("la barrera mira el archivo correcto (no un barrido vacío)", () => {
    // Sin esto, mover el formulario dejaría los tests de arriba pasando por
    // leer un archivo que ya no es el que importa.
    const codigo = fuente();
    expect(codigo).toContain("products.form.price");
    expect(codigo).toContain("basePresentation");
  });
});
