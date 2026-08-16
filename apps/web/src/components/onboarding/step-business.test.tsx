import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { TenantBlock } from "@/lib/tenant/api";
import { StepBusiness } from "./step-business";

/**
 * F1-WEB-ONBOARD-01, paso 1 — catálogo de zonas horarias curado (decisión de
 * Carlos, 2026-08-16): solo México, Estados Unidos y Canadá, con etiquetas
 * "País — Región (Ciudades)". El dato no lo consume nadie en F1; alimenta el
 * corte de día de POS/reportes en F4-F5.
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

function renderStep() {
  const onSubmit = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <StepBusiness
        tenant={tenantFixture()}
        isSubmitting={false}
        formError={null}
        onSubmit={onSubmit}
      />
    </I18nextProvider>,
  );
  return { onSubmit };
}

describe("StepBusiness — zonas horarias", () => {
  it("ofrece solo zonas de México, Estados Unidos y Canadá con etiquetas amigables", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toContain("México — Centro (Ciudad de México)");
    expect(labels).toContain("Estados Unidos — Este (Nueva York, Miami)");
    expect(labels).toContain("Estados Unidos — Pacífico (Los Ángeles)");
    expect(labels).toContain("Canadá — Este (Toronto, Montreal)");
    expect(labels).toContain("Canadá — Pacífico (Vancouver)");

    for (const label of labels) {
      expect(label).toMatch(/^(México|Estados Unidos|Canadá) — /);
    }
  });

  it("ya no ofrece las zonas de Sudamérica que traía la lista original", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const values = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);

    expect(values).not.toContain("America/Bogota");
    expect(values).not.toContain("America/Lima");
    expect(values).not.toContain("America/Santiago");
    expect(values).not.toContain("America/Argentina/Buenos_Aires");
  });

  it("ofrece las tres monedas operacionales: MXN, USD y CAD", () => {
    renderStep();
    const select = screen.getByLabelText("Moneda operacional");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toEqual([
      "Peso mexicano (MXN)",
      "Dólar estadounidense (USD)",
      "Dólar canadiense (CAD)",
    ]);
  });

  it("conserva el default del tenant (America/Mexico_City) seleccionado", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria") as HTMLSelectElement;
    expect(select.value).toBe("America/Mexico_City");
  });
});
