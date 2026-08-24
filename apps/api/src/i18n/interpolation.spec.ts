import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: la interpolación de los mensajes usa llaves SIMPLES.
 *
 * ⚠ El bug que este archivo mata (2026-08-24): cuatro mensajes se escribieron
 * con `{{sku}}` al estilo i18next, pero la configuración del proyecto
 * interpola con `{sku}`. El resultado NO era un error visible: nestjs-i18n
 * dejaba el placeholder crudo y el usuario leía «"{sku}" no tiene existencia
 * vendible en este almacén» — un mensaje que se ve casi bien y no dice nada.
 *
 * Ningún test se ponía rojo porque todos comparaban la CLAVE del error
 * (`code`), no el texto renderizado. Se descubrió al escribir un mensaje
 * nuevo con la sintaxis equivocada y ver el placeholder en la respuesta.
 *
 * Se fija la sintaxis y no el renderizado porque el renderizado depende de
 * quién lance el error; lo que se puede garantizar acá es que ningún mensaje
 * nazca con la forma que NO interpola.
 */
const I18N = __dirname;

function mensajes(): { archivo: string; clave: string; texto: string }[] {
  const salida: { archivo: string; clave: string; texto: string }[] = [];

  for (const locale of readdirSync(I18N, { withFileTypes: true })) {
    if (!locale.isDirectory()) {
      continue;
    }
    const dir = join(I18N, locale.name);
    for (const archivo of readdirSync(dir)) {
      if (!archivo.endsWith(".json")) {
        continue;
      }
      const contenido = JSON.parse(readFileSync(join(dir, archivo), "utf8")) as unknown;
      const recorrer = (valor: unknown, ruta: string) => {
        if (typeof valor === "string") {
          salida.push({ archivo: `${locale.name}/${archivo}`, clave: ruta, texto: valor });
          return;
        }
        if (valor !== null && typeof valor === "object") {
          for (const [k, v] of Object.entries(valor)) {
            recorrer(v, ruta === "" ? k : `${ruta}.${k}`);
          }
        }
      };
      recorrer(contenido, "");
    }
  }

  return salida;
}

describe("interpolación de los mensajes del API", () => {
  it("encuentra mensajes que revisar (la barrera no pasa por un barrido vacío)", () => {
    // Sin esto, mover la carpeta dejaría la lista vacía y el test de abajo
    // pasaría por no tener nada que mirar — la peor clase de verde.
    expect(mensajes().length).toBeGreaterThan(100);
  });

  it("ningún mensaje usa llaves DOBLES: no interpolan y el usuario ve el placeholder", () => {
    const rotos = mensajes()
      .filter(({ texto }) => texto.includes("{{"))
      .map(({ archivo, clave }) => `${archivo} → ${clave}`);

    expect({ conLlavesDobles: rotos }).toEqual({ conLlavesDobles: [] });
  });

  it("el mismo mensaje tiene los MISMOS placeholders en todos los idiomas", () => {
    // Una traducción a la que le falta un dato deja al usuario de ese idioma
    // con menos información, y nadie lo nota hasta que alguien reporta en su
    // idioma. Es el mismo defecto que el anterior, con otra cara.
    const porClave = new Map<string, Map<string, string>>();
    for (const { archivo, clave, texto } of mensajes()) {
      const [locale, fichero] = archivo.split("/");
      const identidad = `${fichero}:${clave}`;
      const placeholders = [...texto.matchAll(/\{([a-zA-Z][\w]*)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",");
      const existente = porClave.get(identidad) ?? new Map<string, string>();
      existente.set(locale as string, placeholders);
      porClave.set(identidad, existente);
    }

    const divergentes = [...porClave.entries()]
      .filter(([, porLocale]) => new Set(porLocale.values()).size > 1)
      .map(([identidad]) => identidad);

    expect({ placeholdersDistintos: divergentes }).toEqual({ placeholdersDistintos: [] });
  });
});
