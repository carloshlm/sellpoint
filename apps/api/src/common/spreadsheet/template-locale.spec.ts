import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spreadsheetFilenameBase, spreadsheetSheetName } from "./filenames";
import { headerLabel } from "./import-headers";

/**
 * BARRERA: una plantilla de importación habla el idioma de quien la descarga,
 * ENTERA (Carlos, 2026-09-12).
 *
 * Bajó la plantilla de proveedores con una cuenta en Canadá y le llegó un
 * archivo llamado «proveedores» con tres encabezados en español —
 * `registro_fiscal`, `contacto`, `notas`— en medio de columnas que sí estaban
 * traducidas. No fue un descuido aislado: el mapa de etiquetas se llena a
 * mano y el test de ida y vuelta que existía solo revisaba una lista de seis
 * claves elegidas a dedo, así que una columna nueva entraba sin traducción y
 * nadie se enteraba hasta que un cliente la veía.
 *
 * Este test BARRE el `STANDARD_COLUMNS` de cada importador en el FUENTE y el
 * `filenameBase` que cada uno pide, y exige que los dos tengan su etiqueta en
 * inglés. Si mañana nace una columna o una plantilla, se pone rojo acá — no
 * en la pantalla de un cliente.
 */
const MODULOS = join(__dirname, "..", "..", "modules");

const IMPORTADORES = [
  "products/import.service.ts",
  "services/services-import.service.ts",
  "warehouses/warehouses-import.service.ts",
  "suppliers/suppliers-import.service.ts",
  "catalogs/catalog-records-import.service.ts",
  "medical-clinic/study-import.service.ts",
] as const;

/** Las columnas estándar declaradas en el fuente de un importador. */
function columnasDe(ruta: string): string[] {
  const fuente = readFileSync(join(MODULOS, ruta), "utf8");
  const bloque = /const STANDARD_COLUMNS = \[([\s\S]*?)\] as const;/.exec(fuente)?.[1];
  return bloque === undefined ? [] : [...bloque.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/** Los `spreadsheetFilenameBase("x", …)` que pide un importador. */
function nombresDeArchivoDe(ruta: string): string[] {
  const fuente = readFileSync(join(MODULOS, ruta), "utf8");
  return [...fuente.matchAll(/spreadsheetFilenameBase\(\s*"([^"]+)"/g)].map((m) => m[1] as string);
}

/** Los `spreadsheetSheetName("X", …)` que pide un importador. */
function nombresDeHojaDe(ruta: string): string[] {
  const fuente = readFileSync(join(MODULOS, ruta), "utf8");
  return [...fuente.matchAll(/spreadsheetSheetName\(\s*"([^"]+)"/g)].map((m) => m[1] as string);
}

describe("la plantilla habla el idioma de quien la descarga", () => {
  it("encuentra las columnas de los seis importadores (la barrera no barre en vacío)", () => {
    // Sin esto, renombrar `STANDARD_COLUMNS` dejaría las listas vacías y el
    // test de abajo pasaría por no tener nada que revisar.
    const total = IMPORTADORES.map(columnasDe).reduce((n, c) => n + c.length, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });

  /**
   * Se escriben IGUAL en los dos idiomas, así que «la etiqueta es la clave» es
   * la traducción correcta y no un olvido. La lista es explícita —y corta— a
   * propósito: agregar una palabra acá es una decisión, no un descuido que
   * pasa inadvertido.
   */
  const IGUALES_EN_LOS_DOS_IDIOMAS = ["sku", "email", "region"];

  it("TODA columna estándar tiene etiqueta en inglés", () => {
    const sinTraducir: string[] = [];
    for (const ruta of IMPORTADORES) {
      for (const columna of columnasDe(ruta)) {
        // Una clave sin entrada en el mapa vuelve igual: eso es lo que se caza.
        if (
          headerLabel(columna, "en") === columna &&
          !IGUALES_EN_LOS_DOS_IDIOMAS.includes(columna)
        ) {
          sinTraducir.push(`${ruta}: ${columna}`);
        }
      }
    }
    expect({ sinTraducir }).toEqual({ sinTraducir: [] });
  });

  it("TODO nombre de archivo y de hoja que pide un importador tiene su versión en inglés", () => {
    const sinTraducir: string[] = [];
    for (const ruta of IMPORTADORES) {
      for (const clave of nombresDeArchivoDe(ruta)) {
        if (spreadsheetFilenameBase(clave, "en") === clave) {
          sinTraducir.push(`${ruta}: archivo «${clave}»`);
        }
      }
      for (const hoja of nombresDeHojaDe(ruta)) {
        if (spreadsheetSheetName(hoja, "en") === hoja) {
          sinTraducir.push(`${ruta}: hoja «${hoja}»`);
        }
      }
    }
    expect({ sinTraducir }).toEqual({ sinTraducir: [] });
  });

  it("las tres columnas de proveedores que faltaban vuelven a su clave desde el inglés", () => {
    for (const clave of ["registro_fiscal", "contacto", "notas"]) {
      expect(headerLabel(clave, "en")).not.toBe(clave);
    }
    expect(headerLabel("registro_fiscal", "en")).toBe("tax_id");
    expect(spreadsheetFilenameBase("proveedores", "en")).toBe("suppliers");
    expect(spreadsheetSheetName("Proveedores", "en")).toBe("Suppliers");
    // Y en español no se toca nada.
    expect(headerLabel("contacto", "es")).toBe("contacto");
    expect(spreadsheetSheetName("Proveedores", "es")).toBe("Proveedores");
  });
});
