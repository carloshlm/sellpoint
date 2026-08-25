import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { INTENT_CLASS, RowAction } from "./row-action";

/**
 * Unificación de las acciones de fila (Carlos, 2026-08-25): cada listado
 * había inventado su propio vocabulario — "Archivar" en subcatálogos,
 * "Quitar" en campos, "Desactivar" en servicios — para la MISMA acción.
 * `RowAction` integra el label a la intención para que la nomenclatura no
 * pueda volver a divergir, y le da a cada intención un color de token del
 * tema (nunca literal: los temas del wizard los re-pintan).
 */
function renderAction(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);
}

describe("RowAction", () => {
  it.each([
    ["edit", "Editar", "text-primary"],
    ["deactivate", "Desactivar", "text-warning"],
    ["reactivate", "Reactivar", "text-success"],
    ["delete", "Eliminar", "text-destructive"],
  ] as const)("intent %s: label «%s» con su color de token", (intent, label, tokenClass) => {
    renderAction(<RowAction intent={intent} onClick={() => {}} />);

    const button = screen.getByRole("button", { name: label });
    expect(button.className).toContain(tokenClass);
  });

  /**
   * Usuarios se SUSPENDE (semántica de cuentas, no de catálogo): el label se
   * puede sobreescribir, pero el color sigue amarrado a la intención.
   */
  it("children sobreescribe el label sin perder el color de la intención", () => {
    renderAction(
      <RowAction intent="deactivate" onClick={() => {}}>
        Suspender
      </RowAction>,
    );

    const button = screen.getByRole("button", { name: "Suspender" });
    expect(button.className).toContain("text-warning");
  });

  /** Mismo contrato que SURFACE: tokens del tema, jamás colores literales. */
  it("el mapa de intenciones no usa colores literales", () => {
    for (const classes of Object.values(INTENT_CLASS)) {
      expect(classes).not.toMatch(/white|black|#|red|green|amber|blue|slate|gray|zinc/);
    }
  });
});
