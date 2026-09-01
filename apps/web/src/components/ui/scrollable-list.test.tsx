import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../../i18n";
import { ScrollableList } from "./scrollable-list";

/**
 * F5-DASH, revisión móvil (Carlos, 2026-08-31). Las listas del panel —tops,
 * atención, caducidades— se desbordaban en un celular y se cortaban en el
 * borde sin decir que había más. Mismo remedio que las tablas
 * (`ScrollableTable`): caja con scroll + aviso con degradado. Es un
 * componente aparte porque vive DENTRO de una tarjeta: no trae la piel
 * `SURFACE` (ya la pone la card) y su leyenda no habla de «columnas».
 */
function pintar(ancho: number, visible: number) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <ScrollableList>
        <ul>
          <li>fila</li>
        </ul>
      </ScrollableList>
    </I18nextProvider>,
  );
  const caja = screen.getByTestId("scrollable-list");
  // jsdom no calcula layout: se simulan las medidas que daría el navegador.
  Object.defineProperty(caja, "scrollWidth", { value: ancho, configurable: true });
  Object.defineProperty(caja, "clientWidth", { value: visible, configurable: true });
  window.dispatchEvent(new Event("resize"));
  return caja;
}

describe("ScrollableList", () => {
  it("la lista siempre vive dentro de un contenedor con scroll horizontal", () => {
    const caja = pintar(300, 300);

    expect(caja.className).toContain("overflow-x-auto");
  });

  it("cuando sobra contenido, LO DICE — con la leyenda de lista, no la de tabla", async () => {
    pintar(600, 300);

    const aviso = await screen.findByTestId("scroll-hint");
    // No dice «columnas»: una lista no las tiene y la leyenda mentiría.
    expect(aviso).toHaveTextContent("Desliza para ver el resto.");
  });

  it("cuando todo cabe, no molesta con una leyenda de más", async () => {
    pintar(300, 300);

    // Esperar un tick: el aviso aparece por efecto, no en el primer render.
    await new Promise((listo) => setTimeout(listo, 0));
    expect(screen.queryByTestId("scroll-hint")).not.toBeInTheDocument();
  });
});
