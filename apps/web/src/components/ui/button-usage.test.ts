import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * BARRERA: un botón principal es el componente `Button` (Carlos, 2026-11-01).
 *
 * «Registrar gasto» en Gastos y «Nuevo» en Proveedores se veían más grandes y
 * con otro color al pasar el cursor que «Nueva sucursal»: eran un `Link` con
 * las clases del botón copiadas a mano (`BOTON_PRIMARIO`), y la copia se
 * había quedado atrás del componente. Lo mismo pasaba en Compras, Órdenes de
 * compra, Pacientes, Consultorio, Inventario y el panel del vendedor.
 *
 * Un botón que navega es `<Button asChild><Link …/></Button>`; uno que actúa,
 * `<Button>`. Esta prueba escanea TODO el web y rechaza un relleno de botón
 * principal escrito a mano: `bg-primary` junto con un `px-N` en el mismo
 * texto de clases. El color de un estado activo (un filtro elegido, un
 * renglón seleccionado) no lleva relleno propio y no se marca.
 */
const SRC = join(__dirname, "..", "..");
const UI = join(SRC, "components", "ui");

function archivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return ruta === UI ? [] : archivosTsx(ruta);
    return ruta.endsWith(".tsx") && !ruta.endsWith(".test.tsx") ? [ruta] : [];
  });
}

/** Los textos de clases que arman a mano un botón principal. */
function botonesAMano(fuente: string): string[] {
  // En una plantilla, lo que va dentro de `${…}` es OTRO texto (el color de
  // un estado activo, por ejemplo): se quita antes de mirar la plantilla.
  const textos = (fuente.match(/"[^"\n]*"|`[^`]*`/g) ?? []).map((texto) =>
    texto.replace(/\$\{[^}]*\}/g, " "),
  );
  return textos.filter(
    (texto) => /(^|[\s"`])bg-primary[\s"`]/.test(texto) && /\bpx-\d/.test(texto),
  );
}

describe("el botón principal es el componente Button", () => {
  it("marca un relleno de botón escrito a mano y deja pasar el color de un estado activo", () => {
    expect(
      botonesAMano('className="rounded-md bg-primary px-4 py-2 text-primary-foreground"'),
    ).toHaveLength(1);
    expect(botonesAMano('activo ? "bg-primary text-primary-foreground" : ""')).toEqual([]);
    expect(botonesAMano('"rounded-md border px-3 data-[state=checked]:bg-primary"')).toEqual([]);
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: es código fuente, lo que lee la barrera
      botonesAMano('`rounded-md border px-3 py-2 ${activo ? "bg-primary text-white" : ""}`'),
    ).toEqual([]);
  });

  it("ningún archivo del web arma un botón principal a mano", () => {
    const culpables = archivosTsx(SRC).flatMap((ruta) =>
      botonesAMano(readFileSync(ruta, "utf8")).map((texto) => `${relative(SRC, ruta)}: ${texto}`),
    );
    expect(culpables).toEqual([]);
  });
});
