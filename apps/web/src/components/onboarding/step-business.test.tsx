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

// Países soportados por el selector: Norteamérica (2026-08-16) + Europa
// (2026-08-16, al agregarse EUR y GBP como monedas operacionales).
const PAISES_SOPORTADOS = [
  "México",
  "Estados Unidos",
  "Canadá",
  "Portugal",
  "España",
  "Francia",
  "Italia",
  "Alemania",
  "Reino Unido",
  "Sudamérica",
];

describe("StepBusiness — zonas horarias", () => {
  it("ofrece las zonas de Norteamérica con etiquetas amigables", () => {
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
  });

  it("ofrece las zonas de los seis países europeos soportados", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toContain("Portugal (Lisboa)");
    expect(labels).toContain("España — Peninsular (Madrid, Barcelona)");
    expect(labels).toContain("Francia (París)");
    expect(labels).toContain("Italia (Roma, Milán)");
    expect(labels).toContain("Alemania (Berlín, Múnich)");
    expect(labels).toContain("Reino Unido — Inglaterra (Londres)");
  });

  it("incluye Canarias, que va una hora atrás de la península española", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toContain("España — Canarias (Las Palmas, Tenerife)");
  });

  it("de Portugal ofrece únicamente Lisboa (decisión de Carlos, 2026-08-16)", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const values = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);

    expect(values).toContain("Europe/Lisbon");
    expect(values).not.toContain("Atlantic/Madeira");
    expect(values).not.toContain("Atlantic/Azores");
  });

  it("no ofrece zonas fuera de los países soportados", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");

    for (const label of labels) {
      expect(PAISES_SOPORTADOS.some((pais) => label.startsWith(pais))).toBe(true);
    }
  });

  it("no ofrece las zonas sudamericanas por ciudad retiradas de la lista original", () => {
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

  it("ofrece la zona regional Sudamérica UTC-4 respaldada por La Paz (sin horario de verano)", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const options = within(select as HTMLElement).getAllByRole("option") as HTMLOptionElement[];

    const laPaz = options.find((option) => option.value === "America/La_Paz");
    expect(laPaz).toBeDefined();
    expect(laPaz?.textContent).toBe("Sudamérica (UTC-4)");
  });

  it("ofrece las cinco monedas operacionales: MXN, USD, CAD, EUR y GBP", () => {
    renderStep();
    const select = screen.getByLabelText("Moneda operacional");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toEqual([
      "Peso mexicano (MXN)",
      "Dólar estadounidense (USD)",
      "Dólar canadiense (CAD)",
      "Euro (EUR)",
      "Libra esterlina (GBP)",
    ]);
  });

  it("conserva el default del tenant (America/Mexico_City) seleccionado", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria") as HTMLSelectElement;
    expect(select.value).toBe("America/Mexico_City");
  });
});
