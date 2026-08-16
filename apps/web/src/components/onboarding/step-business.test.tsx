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

// Países soportados por el selector: Norteamérica + Europa + Latinoamérica
// (Centro y Sudamérica), todos incorporados el 2026-08-16.
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
  "Belice",
  "Costa Rica",
  "El Salvador",
  "Guatemala",
  "Honduras",
  "Nicaragua",
  "Panamá",
  "Argentina",
  "Bolivia",
  "Brasil",
  "Chile",
  "Colombia",
  "Ecuador",
  "Paraguay",
  "Perú",
  "Uruguay",
  "Venezuela",
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

  it("ofrece los siete países de Centroamérica", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toContain("Belice (Belmopán)");
    expect(labels).toContain("Costa Rica (San José)");
    expect(labels).toContain("El Salvador (San Salvador)");
    expect(labels).toContain("Guatemala (Ciudad de Guatemala)");
    expect(labels).toContain("Honduras (Tegucigalpa)");
    expect(labels).toContain("Nicaragua (Managua)");
    expect(labels).toContain("Panamá (Ciudad de Panamá)");
  });

  it("ofrece los diez países de Sudamérica", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toContain("Argentina (Buenos Aires)");
    expect(labels).toContain("Bolivia (La Paz)");
    expect(labels).toContain("Brasil — Brasilia (São Paulo, Río)");
    expect(labels).toContain("Chile — Continental (Santiago)");
    expect(labels).toContain("Colombia (Bogotá)");
    expect(labels).toContain("Ecuador — Continental (Quito, Guayaquil)");
    expect(labels).toContain("Paraguay (Asunción)");
    expect(labels).toContain("Perú (Lima)");
    expect(labels).toContain("Uruguay (Montevideo)");
    expect(labels).toContain("Venezuela (Caracas)");
  });

  it("incluye las zonas secundarias de Brasil, Chile y Ecuador, con offset propio", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toContain("Brasil — Amazonas (Manaos)");
    expect(labels).toContain("Brasil — Acre (Rio Branco)");
    expect(labels).toContain("Chile — Isla de Pascua");
    expect(labels).toContain("Ecuador — Galápagos");
  });

  it("ya no ofrece la entrada regional 'Sudamérica (UTC-4)': La Paz ahora es Bolivia", () => {
    renderStep();
    const select = screen.getByLabelText("Zona horaria");
    const options = within(select as HTMLElement).getAllByRole("option") as HTMLOptionElement[];

    const laPaz = options.find((option) => option.value === "America/La_Paz");
    expect(laPaz?.textContent).toBe("Bolivia (La Paz)");
    expect(options.map((option) => option.textContent)).not.toContain("Sudamérica (UTC-4)");
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
