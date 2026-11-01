import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { ROW_ACTIONS_CELL, RowActionsHead, RowActionsTh } from "./row-action";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "./table";

/**
 * BARRERA de la columna de acciones (Carlos, 2026-11-01): en Sucursales,
 * Subcatálogos, Servicios y Productos los botones Editar / Desactivar /
 * Eliminar se apilaban uno debajo del otro en el celular, mientras que en
 * Categorías de gasto iban en una sola línea. Y ningún listado titulaba esa
 * columna. La regla ahora vive en UN lugar (`row-action.tsx`):
 *
 * - `ROW_ACTIONS_CELL`: la celda deja las acciones en una línea, a la derecha.
 * - `RowActionsHead` / `RowActionsTh`: el encabezado «Acciones», para las
 *   tablas del componente `Table` y para las crudas.
 *
 * Esta prueba lee el CÓDIGO de cada tabla con acciones y exige las dos cosas,
 * para que la próxima tabla no nazca distinta.
 */
function renderEs(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);
}

describe("la columna de acciones de los listados", () => {
  it("la celda deja las acciones en una sola línea, alineadas a la derecha", () => {
    expect(ROW_ACTIONS_CELL.split(" ")).toEqual(
      expect.arrayContaining(["whitespace-nowrap", "text-right"]),
    );
  });

  it("RowActionsHead titula la columna «Acciones», a la derecha como sus botones", () => {
    renderEs(
      <Table>
        <TableHeader>
          <TableRow>
            <RowActionsHead className="px-2" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className={ROW_ACTIONS_CELL}>—</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const encabezado = screen.getByRole("columnheader", { name: "Acciones" });
    expect(encabezado).toHaveClass("text-right", "px-2");
  });

  it("RowActionsTh hace lo mismo en una tabla cruda, con el relleno de la tabla", () => {
    renderEs(
      <table>
        <thead>
          <tr>
            <RowActionsTh className="p-2" />
          </tr>
        </thead>
      </table>,
    );

    const encabezado = screen.getByRole("columnheader", { name: "Acciones" });
    expect(encabezado.tagName).toBe("TH");
    expect(encabezado).toHaveClass("text-right", "p-2");
  });

  it("en inglés la columna se llama «Actions»", async () => {
    const i18n = createI18n();
    await i18n.changeLanguage("en");
    render(
      <I18nextProvider i18n={i18n}>
        <table>
          <thead>
            <tr>
              <RowActionsTh />
            </tr>
          </thead>
        </table>
      </I18nextProvider>,
    );

    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });

  const RAIZ = join(__dirname, "..", "..");
  const fuente = (ruta: string): string => readFileSync(join(RAIZ, ruta), "utf8");

  /** Todos los .tsx de `src`, sin pruebas, en rutas relativas a `src`. */
  const archivos = (readdirSync(RAIZ, { recursive: true }) as string[])
    .map((ruta) => ruta.split("\\").join("/"))
    .filter((ruta) => ruta.endsWith(".tsx") && !ruta.endsWith(".test.tsx"));

  // DERIVADA: toda tabla que pinta un `RowAction` dentro de una celda. La que
  // nazca mañana entra sola a esta lista.
  const conRowAction = archivos.filter((ruta) => {
    const codigo = fuente(ruta);
    return /<RowAction[\s>]/.test(codigo) && /<(TableCell|td)[\s>]/.test(codigo);
  });

  // EXPLÍCITA: tablas cuya última columna son acciones sin `RowAction`
  // (botones con borde, enlaces «Ver», «Quitar» de una línea de captura).
  // Al agregar una tabla así, agrégala aquí en el mismo commit.
  const sinRowAction = [
    "components/admin/tenant-users-tab.tsx",
    "components/billing/payment-history-table.tsx",
    "components/catalog/composition-tab.tsx",
    "components/catalog/quick-catalog-table.tsx",
    "components/inventory/expiring-list.tsx",
    "components/inventory/transfers-list.tsx",
    "components/profile/reception-settings.tsx",
    "components/purchase-orders/purchase-order-lines-table.tsx",
    "components/purchase-orders/purchase-order-list.tsx",
    "components/purchase-orders/purchase-receipt-detail.tsx",
    "components/purchases/purchase-lines-table.tsx",
    "routes/admin.billing.tsx",
    "routes/reception.turns.tsx",
  ];

  it("la lista derivada encuentra las tablas que ya existen (no está vacía)", () => {
    expect(conRowAction).toEqual(
      expect.arrayContaining([
        "routes/warehouses.tsx",
        "routes/catalog.lists.tsx",
        "routes/catalog.services.tsx",
        "routes/catalog.products.tsx",
        "routes/expenses.categories.tsx",
      ]),
    );
    // Las listas que no son tabla (`<ul>`) no entran: no tienen encabezado.
    expect(conRowAction).not.toContain("components/form/row-list.tsx");
    expect(conRowAction).not.toContain("components/catalog/field-list.tsx");
  });

  it.each([...conRowAction, ...sinRowAction])(
    "%s titula «Acciones» y deja sus acciones en una línea",
    (ruta) => {
      const codigo = fuente(ruta);
      // Con mensaje propio: sin él, un fallo vuelca el archivo entero.
      const cumple = (regla: RegExp, mensaje: string) =>
        expect(regla.test(codigo), `${ruta}: ${mensaje}`).toBe(true);
      const noTiene = (regla: RegExp, mensaje: string) =>
        expect(regla.test(codigo), `${ruta}: ${mensaje}`).toBe(false);

      // USADA en una clase, no solo importada: un import huérfano no alinea nada.
      cumple(/className=\{[^}]*ROW_ACTIONS_CELL/, "la celda de acciones no usa ROW_ACTIONS_CELL");
      cumple(/<RowActions(Head|Th)[\s/>]/, "el encabezado no usa RowActionsHead ni RowActionsTh");
      // El encabezado vacío de antes no vuelve: la columna lleva su título.
      noTiene(/<TableHead(\s+className="[^"]*")?\s*\/>/, "queda un <TableHead /> vacío");
      noTiene(/<th(\s+className="[^"]*")?\s*\/>/, "queda un <th /> vacío");
    },
  );

  /**
   * Carlos (2026-11-01): en Proveedores y Registro de paciente el «Editar» era
   * un enlace con estilo propio (subrayado al pasar el cursor) junto a
   * «Eliminar», que sí es un `RowAction`. Una acción de fila que navega es un
   * `RowAction` con `asChild` sobre el `Link`: mismo color, mismo resaltado.
   */
  it("ningún enlace de acción de fila usa el estilo suelto de subrayado", () => {
    const sueltos = archivos.filter((ruta) =>
      fuente(ruta).includes(
        "inline-flex h-8 items-center px-3 font-medium text-primary text-sm hover:underline",
      ),
    );
    expect(sueltos, `Enlaces de acción con estilo propio:\n${sueltos.join("\n")}`).toEqual([]);
  });
});
