import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: ningún e2e arranca su app con `app.init()` a secas.
 *
 * **El porqué, que es lo único que importa acá:** `init()` no pone el servidor
 * a escuchar, y sin dirección supertest abre un listener efímero **por cada
 * petición**. Medido el 2026-08-21 sobre `pos-lookup.e2e-spec.ts`: 110
 * requests, 110 puertos distintos. Con `listen(0)`, 110 requests y UN puerto.
 *
 * Una corrida completa hace más de 4.000 peticiones contra el rango efímero de
 * macOS (~16k) con TIME_WAIT de 15 s. Los puertos se reciclan mientras el
 * anterior sigue muriendo, el cliente lee una conexión ajena, y sale
 * `read ECONNRESET`. Ese fue el flake que estuvo días sin causa: caía en un
 * spec distinto cada corrida y siempre pasaba aislado.
 *
 * Este test existe porque el arreglo es invisible. Un spec nuevo copiado de
 * otro archivo viejo, o escrito de memoria con el `app.init()` que sale en toda
 * la documentación de Nest, reintroduce el bug sin que nada se ponga rojo —
 * hasta que semanas después alguien vuelva a perseguir un flake fantasma.
 *
 * Corre en la suite UNITARIA a propósito: es lectura de archivos, no necesita
 * levantar nada, y así falla en segundos en vez de al final de los e2e.
 */
const E2E_DIR = join(__dirname, "../../test/e2e");

function especificaciones(): string[] {
  return readdirSync(E2E_DIR).filter((f) => f.endsWith(".e2e-spec.ts"));
}

/**
 * El archivo sin comentarios.
 *
 * Hace falta porque `auth-throttling` EXPLICA en un comentario por qué su
 * throttler se configura después de `app.init()`, y la barrera lo señalaba
 * como culpable. Una barrera que se dispara con prosa es una que la gente
 * aprende a esquivar reescribiendo comentarios en vez de arreglando código.
 *
 * El recorte es ingenuo —no distingue un `//` dentro de un string— y está bien:
 * esto es una red de seguridad sobre archivos de test, no un parser. El costo
 * de un falso negativo acá es que un spec se cuele; el de un falso positivo,
 * que nadie confíe en la barrera.
 */
function sinComentarios(ruta: string): string {
  return readFileSync(ruta, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Los e2e arrancan con `startTestApp`, no con `app.init()`", () => {
  it("hay specs que revisar (la barrera no se está saltando por una ruta mal puesta)", () => {
    // Sin esto, mover la carpeta dejaría la lista vacía y los dos tests de
    // abajo pasarían por no tener nada que mirar — la peor clase de test verde.
    expect(especificaciones().length).toBeGreaterThan(30);
  });

  it("ninguno llama `app.init()` por su cuenta", () => {
    const culpables = especificaciones().filter((f) =>
      /\bapp\.init\(\)/.test(sinComentarios(join(E2E_DIR, f))),
    );

    // El objeto y no el array pelado: así el diff de Jest NOMBRA el problema
    // («quemanUnPuertoPorPeticion») además de listar los archivos. Mismo idioma
    // que la barrera de permisos.
    expect({ quemanUnPuertoPorPeticion: culpables }).toEqual({
      quemanUnPuertoPorPeticion: [],
    });
  });

  it("todos usan el helper", () => {
    const sinHelper = especificaciones().filter(
      (f) => !sinComentarios(join(E2E_DIR, f)).includes("startTestApp(app)"),
    );

    expect({ sinStartTestApp: sinHelper }).toEqual({ sinStartTestApp: [] });
  });
});
