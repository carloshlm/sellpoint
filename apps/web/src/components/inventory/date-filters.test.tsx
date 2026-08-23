import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: el Kardex y los listados de movimientos filtran por rango de
 * fechas (2026-08-23, pedido de Carlos).
 *
 * Los dos APIs ya aceptaban `from`/`to` —y los aplican— desde F3: lo que
 * faltaba era la pantalla. Este test es de FUENTE porque lo que se protege es
 * el CABLEADO: que el filtro exista, que su valor llegue a la consulta, y que
 * el Kardex arranque acotado. Un test de render probaría un componente; esto
 * prueba que los cuatro sitios sigan conectados cuando alguien refactorice.
 */
const COMPONENTES = join(__dirname);

const fuente = (archivo: string): string => readFileSync(join(COMPONENTES, archivo), "utf8");

describe("filtro de fechas en Kardex y movimientos", () => {
  it.each(["kardex-tab.tsx", "document-list.tsx"])("%s monta el filtro compartido", (archivo) => {
    const codigo = fuente(archivo);

    expect(codigo).toContain("DateRangeFilter");
    // No basta con pintarlo: su valor tiene que viajar a la consulta, o sería
    // un control decorativo que no filtra nada.
    expect(codigo).toMatch(/from:\s*\w|\.\.\.\(rango\.from/);
  });

  /**
   * «En una vista inicial solo muestra los movimientos de los últimos 30
   * días» (Carlos). Un kardex de un producto con dos años de historia abre
   * con cientos de renglones y el usuario no encuentra el de ayer.
   */
  it("el Kardex arranca acotado a los últimos 30 días", () => {
    const codigo = fuente("kardex-tab.tsx");

    expect(codigo).toContain("rangoUltimosDias");
    expect(codigo).toMatch(/rangoUltimosDias\(\s*(?:30|DIAS_INICIALES)/);
  });

  /**
   * El listado de movimientos NO arranca acotado, y es deliberado: se abre
   * para encontrar el documento que se acaba de crear, y un rango por defecto
   * escondería los borradores viejos que alguien dejó a medias.
   */
  it("los listados de movimientos abren SIN rango puesto", () => {
    const codigo = fuente("document-list.tsx");

    expect(codigo).not.toContain("rangoUltimosDias");
  });

  it("el rango cuenta como filtro activo (el aviso de «sin resultados» no miente)", () => {
    // Si el rango no entra en `filtrando`, una búsqueda vacía por fechas diría
    // «todavía no hay documentos» en vez de «no hay en este rango».
    expect(fuente("document-list.tsx")).toMatch(/filtrando\s*=[^;]*rango/s);
  });
});
