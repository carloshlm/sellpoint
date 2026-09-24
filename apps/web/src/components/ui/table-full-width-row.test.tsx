import { fireEvent, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { ScrollableTable } from "./scrollable-table";
import { Table, TableBody, TableCell, TableRow } from "./table";

/**
 * F10-MANFIX-18 (2026-09-24): en el celular, el aviso de confirmación que se
 * pinta DENTRO de una tabla —cancelar una venta, cancelar una cotización—
 * salía cortado con la tabla desplazada. Su fila a lo ancho (`<td colSpan>`)
 * mide lo que la tabla entera (820 px en el historial de ventas), no lo que
 * se ve (349 px), y los botones quedaban fuera hasta deslizar la tabla.
 *
 * La corrección vive en la CAJA con scroll, como el aviso de «Desliza»: las
 * dos formas de tabla de la casa publican cuánto se ve y anclan el panel de
 * la fila a lo ancho a esa parte. Lo heredan las tablas de hoy y las que
 * todavía no existen, sin que ninguna tenga que acordarse de nada.
 *
 * jsdom no calcula layout: acá se afirma la estructura (la variable y la
 * regla); que el aviso se vea entero se verificó en el navegador.
 */
const CLASES_DE_LA_REGLA = [
  "[&_td[colspan]:only-child>*]:sticky",
  "[&_td[colspan]:only-child>*]:left-2",
  "[&_td[colspan]:only-child>*]:max-w-[calc(var(--table-visible-width)-1rem)]",
];

function conI18n(tabla: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n()}>{tabla}</I18nextProvider>);
}

function pintarTable(): HTMLElement {
  conI18n(
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>VTA-000482</TableCell>
          <TableCell>Cancelar</TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={2}>
            <div role="alertdialog" aria-label="Cancelar la venta VTA-000482">
              …
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
  return document.querySelector('[data-slot="table-container"]') as HTMLElement;
}

function pintarScrollableTable(): HTMLElement {
  conI18n(
    <ScrollableTable>
      <table>
        <tbody>
          <tr>
            <td>COT-000002</td>
            <td>Cancelar</td>
          </tr>
          <tr>
            <td colSpan={2}>
              <div role="alertdialog" aria-label="Cancelar la cotización COT-000002">
                …
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollableTable>,
  );
  return document.querySelector('[data-testid="scrollable-table"]') as HTMLElement;
}

/** Las medidas que daría el navegador con la caja de ese ancho. */
function medirCon(caja: HTMLElement, visible: number) {
  Object.defineProperty(caja, "clientWidth", { value: visible, configurable: true });
  Object.defineProperty(caja, "scrollWidth", { value: 820, configurable: true });
}

describe.each([
  ["el <Table> de la casa", pintarTable],
  ["ScrollableTable", pintarScrollableTable],
])("%s: el aviso de una fila a lo ancho se queda en lo que se ve", (_, pintar) => {
  it("publica el ancho visible de la caja para que el panel lo tome", () => {
    const caja = pintar();

    medirCon(caja, 349);
    fireEvent.scroll(caja);

    expect(caja.style.getPropertyValue("--table-visible-width")).toBe("349px");
  });

  it("lo vuelve a publicar cuando la caja cambia de ancho (girar el celular)", () => {
    const caja = pintar();
    medirCon(caja, 349);
    fireEvent.scroll(caja);

    medirCon(caja, 700);
    window.dispatchEvent(new Event("resize"));

    expect(caja.style.getPropertyValue("--table-visible-width")).toBe("700px");
  });

  it("sin una medida real no publica nada: un ancho de 0 encogería el aviso hasta desaparecer", () => {
    const caja = pintar();

    // jsdom da 0 de ancho, como un navegador con la tabla todavía oculta.
    fireEvent.scroll(caja);

    expect(caja.style.getPropertyValue("--table-visible-width")).toBe("");
  });

  it("ancla el panel de una fila de UNA sola celda: fijo a la izquierda y nunca más ancho que lo visible", () => {
    const caja = pintar();

    // Una fila con una sola celda a lo ancho es un aviso o un editor; una de
    // totales («Total» con colSpan y el importe al lado) no es `only-child`.
    expect(caja.className.split(/\s+/)).toEqual(expect.arrayContaining(CLASES_DE_LA_REGLA));
    expect(caja.querySelector("td[colspan]:only-child > [role='alertdialog']")).not.toBeNull();
  });
});
