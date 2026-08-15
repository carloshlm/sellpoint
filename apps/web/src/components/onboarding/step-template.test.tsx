import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { TenantBlock } from "@/lib/tenant/api";
import { StepTemplate } from "./step-template";

/**
 * F1-WEB-ONBOARD-02 (tarea 02.1/02.2). CU-AUTH-02, paso 2: elegir plantilla
 * de schema (Farmacia, Ferretería, Abarrotes, Personalizado) — SOLO
 * "elegir", sin editor (D2). El submit real (PATCH /tenants/me) lo hace el
 * container (`routes/onboarding.tsx`); acá solo se emite `onSubmit(choice)`.
 */
function tenantFixture(overrides: Partial<TenantBlock> = {}): TenantBlock {
  return {
    id: "tenant-1",
    name: "Acme",
    legalName: "Acme SA de CV",
    taxId: "ACM010101AAA",
    address: "Av. Siempre Viva 123",
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: false,
    ...overrides,
  };
}

function renderStep(props: Partial<React.ComponentProps<typeof StepTemplate>> = {}) {
  const onSubmit = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <StepTemplate tenant={tenantFixture()} isSubmitting={false} onSubmit={onSubmit} {...props} />
    </I18nextProvider>,
  );
  return { onSubmit };
}

describe("StepTemplate", () => {
  it("muestra las 4 plantillas del tablero (CU-AUTH-02)", () => {
    renderStep();

    expect(screen.getByRole("radio", { name: "Farmacia" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ferretería" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Abarrotes" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Personalizado" })).toBeInTheDocument();
  });

  it("sin elegir ninguna, Continuar está deshabilitado", () => {
    renderStep();

    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("elegir una tarjeta la marca como seleccionada y habilita Continuar", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("radio", { name: "Ferretería" }));

    expect(screen.getByRole("radio", { name: "Ferretería" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("con templateChoice ya persistido, esa tarjeta nace seleccionada", () => {
    renderStep({ tenant: tenantFixture({ templateChoice: "grocery" }) });

    expect(screen.getByRole("radio", { name: "Abarrotes" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Continuar emite onSubmit con el código de la plantilla elegida", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(screen.getByRole("radio", { name: "Farmacia" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(onSubmit).toHaveBeenCalledWith("pharmacy");
  });

  it("muestra el formError cuando el PATCH falla", () => {
    renderStep({ formError: "No pudimos guardar la plantilla." });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos guardar la plantilla.");
  });
});
