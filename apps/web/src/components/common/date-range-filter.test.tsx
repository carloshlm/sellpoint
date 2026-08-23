import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { DateRangeFilter, rangoUltimosDias } from "./date-range-filter";

/**
 * F3/F5 — el filtro de rango de fechas (2026-08-23, pedido de Carlos).
 *
 * Uno solo para el Kardex y para los tres listados de movimientos. Se hace
 * compartido y no copiado porque son cuatro sitios hoy y los reportes de la
 * Fase 5 van a pedir el quinto: cuatro copias divergen y la que se quede
 * atrás miente sin ponerse roja.
 */
function renderFiltro(props: Partial<React.ComponentProps<typeof DateRangeFilter>> = {}) {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <DateRangeFilter id="prueba" from="" to="" onChange={onChange} {...props} />
    </I18nextProvider>,
  );
  return onChange;
}

describe("DateRangeFilter", () => {
  it("pinta dos campos de fecha, con etiqueta cada uno", () => {
    renderFiltro();

    // `type="date"` no expone rol `textbox`: se buscan por etiqueta.
    expect(screen.getByLabelText(/Desde/i)).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(/Hasta/i)).toHaveAttribute("type", "date");
  });

  it("avisa el rango COMPLETO al cambiar un extremo", async () => {
    const onChange = renderFiltro({ from: "2026-08-01", to: "2026-08-20" });

    // `fireEvent.change` y no `userEvent.type`: en un `<input type="date">`
    // CONTROLADO, teclear carácter por carácter produce valores parciales que
    // el padre nunca vería en la app real —el navegador emite el cambio con
    // la fecha completa—. Escribir el test con `type` mediría el arnés.
    fireEvent.change(screen.getByLabelText(/Hasta/i), { target: { value: "2026-08-31" } });

    // El padre necesita el par entero para armar la consulta; mandar solo el
    // extremo que cambió lo obligaría a recordar el otro.
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("`Hasta` no puede ser anterior a `Desde`", () => {
    renderFiltro({ from: "2026-08-10", to: "" });

    // El navegador lo impide con `min`: un rango invertido devolvería vacío y
    // el usuario creería que no hay movimientos.
    expect(screen.getByLabelText(/Hasta/i)).toHaveAttribute("min", "2026-08-10");
  });

  it("ofrece limpiar el rango cuando hay algo puesto", async () => {
    const onChange = renderFiltro({ from: "2026-08-01", to: "2026-08-20" });

    await userEvent.click(screen.getByRole("button", { name: /Limpiar|Clear/i }));

    expect(onChange).toHaveBeenLastCalledWith({ from: "", to: "" });
  });

  it("sin rango puesto, no hay nada que limpiar", () => {
    renderFiltro();

    expect(screen.queryByRole("button", { name: /Limpiar|Clear/i })).not.toBeInTheDocument();
  });
});

describe("rangoUltimosDias", () => {
  it("devuelve el rango cerrado de los últimos N días, hoy incluido", () => {
    const hoy = new Date("2026-08-23T15:00:00Z");

    // 30 días CONTANDO hoy: del 25 de julio al 23 de agosto son 30 fechas.
    expect(rangoUltimosDias(30, hoy)).toEqual({ from: "2026-07-25", to: "2026-08-23" });
  });

  it("cruza el cambio de año sin inventar fechas", () => {
    expect(rangoUltimosDias(30, new Date("2026-01-10T00:00:00Z"))).toEqual({
      from: "2025-12-12",
      to: "2026-01-10",
    });
  });
});
