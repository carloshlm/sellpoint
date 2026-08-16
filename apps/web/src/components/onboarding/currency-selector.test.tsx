import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { CurrencySelector } from "./currency-selector";

/**
 * F1-LOCALE-07 (F1-WEB-ONBOARD-01, tarea 01.21/01.22). Presentacional puro:
 * el guard de inmutabilidad post-transacciones vive SOLO en el backend
 * (`TenantCurrencyChangeableGuard`) — acá solo el copy de advertencia, sin
 * reimplementar la regla.
 */
function renderSelector(props: Partial<React.ComponentProps<typeof CurrencySelector>> = {}) {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <CurrencySelector value="MXN" onChange={onChange} {...props} />
    </I18nextProvider>,
  );
  return { onChange };
}

describe("CurrencySelector", () => {
  it("muestra MXN y USD como opciones, con MXN preseleccionado por default", () => {
    renderSelector();

    const select = screen.getByLabelText("Moneda operacional") as HTMLSelectElement;
    expect(select.value).toBe("MXN");
    expect(screen.getByRole("option", { name: "Peso mexicano (MXN)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Dólar estadounidense (USD)" })).toBeInTheDocument();
  });

  it("no muestra la advertencia de inmutabilidad (retirada por Carlos, 2026-08-16)", () => {
    renderSelector();

    expect(screen.queryByText(/no vas a poder cambiar la moneda/i)).not.toBeInTheDocument();
  });

  it("elegir USD emite onChange('USD') — la persistencia real la hace el form contenedor vía PATCH", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelector();

    await user.selectOptions(screen.getByLabelText("Moneda operacional"), "USD");

    expect(onChange).toHaveBeenCalledWith("USD");
  });
});
