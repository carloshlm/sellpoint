import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { StepWarehouse } from "./step-warehouse";

/**
 * F1-WEB-ONBOARD-03 (tarea 02.3/02.4). Paso 3 del wizard, placeholder de
 * almacén — el CRUD real es F2 (D2). Acá no hay formulario: solo un mensaje
 * informativo y "Continuar". El submit real (PATCH /tenants/me con
 * `warehouseStepSeen: true`, apply-progress Deviation 6) lo hace el
 * container (`routes/onboarding.tsx`); acá solo se emite `onSubmit()`.
 */
function renderStep(props: Partial<React.ComponentProps<typeof StepWarehouse>> = {}) {
  const onSubmit = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <StepWarehouse isSubmitting={false} onSubmit={onSubmit} {...props} />
    </I18nextProvider>,
  );
  return { onSubmit };
}

describe("StepWarehouse", () => {
  it("muestra el mensaje informativo del paso 3", () => {
    renderStep();

    expect(screen.getByTestId("step-warehouse")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("Continuar emite onSubmit sin datos (sin formulario, sin CRUD de almacén en F1)", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(onSubmit).toHaveBeenCalledWith();
  });

  it("muestra el formError cuando el PATCH falla", () => {
    renderStep({ formError: "No pudimos avanzar." });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos avanzar.");
  });

  it("mientras isSubmitting, Continuar queda deshabilitado", () => {
    renderStep({ isSubmitting: true });

    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
  });
});
