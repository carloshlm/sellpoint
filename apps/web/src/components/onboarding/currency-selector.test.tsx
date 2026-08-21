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

  it("elegir USD emite onChange('USD') — la persistencia real la hace el form contenedor vía PATCH", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelector();

    await user.selectOptions(screen.getByLabelText("Moneda operacional"), "USD");

    expect(onChange).toHaveBeenCalledWith("USD");
  });
});

/**
 * El aviso volvió el 2026-08-21, y la razón es que **la circunstancia cambió**.
 *
 * Se había retirado el 2026-08-16 (decisión de Carlos) y era lo correcto
 * entonces: `TenantTransactionsGate.hasTransactions()` devolvía `false`
 * SIEMPRE desde F1, así que el aviso prometía un bloqueo que no existía — y un
 * aviso que no se cumple enseña a ignorar los avisos.
 *
 * F3-GUARDS-01 arregló ese gate: hoy cuenta `stock_movements` de verdad y la
 * moneda **sí** se congela con el primer movimiento. El texto que era mentira
 * pasó a ser cierto, y nadie lo notó porque arreglar un guard no avisa que
 * revive un aviso que se había jubilado.
 *
 * Este test existe para que la próxima vez no dependa de que alguien lo note.
 */
describe("el aviso de que la moneda se congela", () => {
  it("se muestra junto al selector", () => {
    renderSelector();

    expect(screen.getByText(/no podrás cambiar la moneda/i)).toBeInTheDocument();
  });
});
