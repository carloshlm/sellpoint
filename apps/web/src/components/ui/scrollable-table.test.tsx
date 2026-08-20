import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../../i18n";
import { ScrollableTable } from "./scrollable-table";

/**
 * F4-FIX (2026-08-20). Una tabla de nueve columnas en 390 px no cabe, y eso
 * está bien: lo que NO está bien es que se corte en el borde **sin decir que
 * hay más**. El usuario no descubre lo que no sabe que existe.
 */
function pintar(ancho: number, visible: number) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <ScrollableTable>
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>
    </I18nextProvider>,
  );
  const caja = screen.getByTestId("scrollable-table");
  // jsdom no calcula layout: se simulan las medidas que daría el navegador.
  Object.defineProperty(caja, "scrollWidth", { value: ancho, configurable: true });
  Object.defineProperty(caja, "clientWidth", { value: visible, configurable: true });
  window.dispatchEvent(new Event("resize"));
  return caja;
}

describe("ScrollableTable", () => {
  it("la tabla siempre vive dentro de un contenedor con scroll horizontal", () => {
    const caja = pintar(300, 300);

    expect(caja.className).toContain("overflow-x-auto");
  });

  it("cuando hay más columnas de las que caben, LO DICE", async () => {
    pintar(600, 300);

    expect(await screen.findByTestId("scroll-hint")).toBeInTheDocument();
  });

  it("cuando todo cabe, no molesta con una leyenda de más", async () => {
    pintar(300, 300);

    // Esperar un tick: el aviso aparece por efecto, no en el primer render.
    await new Promise((listo) => setTimeout(listo, 0));
    expect(screen.queryByTestId("scroll-hint")).not.toBeInTheDocument();
  });
});
