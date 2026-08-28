import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { Table, TableBody, TableCell, TableRow } from "./table";

/**
 * Carlos (2026-08-29): «en las tablas quiero que todas tengan el scroll
 * parecido a los listados de Entradas (degradado del lado derecho y la
 * leyenda "Desliza para ver más columnas"); he visto que Productos,
 * Servicios, Subcatálogos y Almacenes no lo tienen».
 *
 * La causa era que el aviso vivía en `ScrollableTable`, que solo envolvía a
 * las tablas armadas a mano. Todo lo que usa el `<Table>` de la casa —que es
 * casi todo— se cortaba en el borde sin decir que seguía. El aviso se mudó al
 * contenedor de `<Table>`, así que ahora lo hereda cualquier listado, incluidos
 * los que todavía no existen.
 */
function renderTabla() {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Producto</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </I18nextProvider>,
  );
}

describe("el aviso de scroll del <Table> de la casa", () => {
  it("no molesta cuando la tabla cabe entera", () => {
    renderTabla();

    // jsdom da scrollWidth === clientWidth: la tabla "cabe", y una leyenda
    // permanente se volvería parte del decorado.
    expect(screen.queryByTestId("scroll-hint")).not.toBeInTheDocument();
  });

  it("aparece —con su degradado— cuando sobran columnas", () => {
    renderTabla();
    const caja = document.querySelector('[data-slot="table-container"]') as HTMLElement;

    // jsdom no calcula layout: se declaran las medidas que tendría una tabla
    // más ancha que su caja y se dispara la medición como lo haría el scroll.
    Object.defineProperty(caja, "scrollWidth", { value: 900, configurable: true });
    Object.defineProperty(caja, "clientWidth", { value: 320, configurable: true });
    fireEvent.scroll(caja);

    expect(screen.getByTestId("scroll-hint")).toHaveTextContent(/Desliza la tabla/);
    expect(document.querySelector(".bg-gradient-to-l")).not.toBeNull();
  });
});
