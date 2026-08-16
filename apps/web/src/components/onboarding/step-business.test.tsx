import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { TenantBlock } from "@/lib/tenant/api";
import { StepBusiness } from "./step-business";

/**
 * F1-WEB-ONBOARD-01, paso 1. Ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md
 * §2): `country` es el PRIMER campo, requerido, y maneja la zona horaria
 * curada por país y la etiqueta fiscal dinámica. La fixture arranca en
 * México (`country: "MX"`) — la mayoría de los tests que necesitan OTRO
 * país cambian la selección con `selectCountry` (decisión 7: la derivación
 * de zona/moneda corre en el CAMBIO de país, no al montar — A4 del design,
 * `defaultValues` nunca se pisan solos).
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
    country: "MX",
    ...overrides,
  };
}

function renderStep(overrides: Partial<TenantBlock> = {}) {
  const onSubmit = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <StepBusiness
        tenant={tenantFixture(overrides)}
        isSubmitting={false}
        formError={null}
        onSubmit={onSubmit}
      />
    </I18nextProvider>,
  );
  return { onSubmit };
}

function timezoneSelect() {
  return screen.getByLabelText("Zona horaria") as HTMLSelectElement;
}

function timezoneLabels() {
  return within(timezoneSelect())
    .getAllByRole("option")
    .map((option) => option.textContent);
}

function timezoneValues() {
  return within(timezoneSelect())
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value);
}

async function selectCountry(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.selectOptions(screen.getByLabelText("País"), code);
}

describe("StepBusiness — país (ad-hoc post-Fase 1, 2026-08-16, MERCADOS.md §2)", () => {
  it("es requerido: sin país en el tenant, el select arranca en el placeholder", () => {
    renderStep({ country: null });
    const select = screen.getByLabelText("País") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Elige un país" })).toBeInTheDocument();
  });

  it("ofrece nombres de país vía Intl.DisplayNames — nunca el código ISO crudo", () => {
    renderStep();
    const select = screen.getByLabelText("País");
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toContain("México");
    expect(labels).toContain("Japón");
    expect(labels).not.toContain("MX");
    expect(labels).not.toContain("JP");
  });

  it("conserva el país del tenant preseleccionado", () => {
    renderStep({ country: "PT" });
    expect((screen.getByLabelText("País") as HTMLSelectElement).value).toBe("PT");
  });
});

describe("StepBusiness — zonas horarias curadas por país (decisión de Carlos, 2026-08-16)", () => {
  it("país curado con varias zonas ofrece SOLO las suyas — México, sin mezclar otro país", () => {
    renderStep();
    expect(timezoneLabels()).toEqual([
      "México — Centro (Ciudad de México)",
      "México — Sureste (Cancún)",
      "México — Sonora (Hermosillo)",
      "México — Pacífico (Tijuana)",
    ]);
    for (const label of timezoneLabels()) {
      expect((label ?? "").startsWith("México")).toBe(true);
    }
  });

  it("Estados Unidos: sus siete zonas, ninguna de otro país", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "US");

    expect(timezoneLabels()).toEqual([
      "Estados Unidos — Este (Nueva York, Miami)",
      "Estados Unidos — Centro (Chicago, Dallas)",
      "Estados Unidos — Montaña (Denver)",
      "Estados Unidos — Arizona (Phoenix)",
      "Estados Unidos — Pacífico (Los Ángeles)",
      "Estados Unidos — Alaska (Anchorage)",
      "Estados Unidos — Hawái (Honolulu)",
    ]);
  });

  it("Canadá: sus seis zonas", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "CA");

    expect(timezoneLabels()).toEqual([
      "Canadá — Terranova (St. John's)",
      "Canadá — Atlántico (Halifax)",
      "Canadá — Este (Toronto, Montreal)",
      "Canadá — Centro (Winnipeg)",
      "Canadá — Montaña (Edmonton, Calgary)",
      "Canadá — Pacífico (Vancouver)",
    ]);
  });

  it("España incluye Canarias, aparte de la peninsular (offset distinto)", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "ES");

    expect(timezoneLabels()).toEqual([
      "España — Peninsular (Madrid, Barcelona)",
      "España — Canarias (Las Palmas, Tenerife)",
    ]);
  });

  it("Brasil incluye sus zonas secundarias con offset propio (Amazonas, Acre)", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "BR");

    expect(timezoneLabels()).toEqual([
      "Brasil — Brasilia (São Paulo, Río)",
      "Brasil — Amazonas (Manaos)",
      "Brasil — Acre (Rio Branco)",
    ]);
  });

  it("Chile incluye Isla de Pascua, aparte de la continental", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "CL");

    expect(timezoneLabels()).toEqual(["Chile — Continental (Santiago)", "Chile — Isla de Pascua"]);
  });

  it("Ecuador incluye Galápagos, aparte de la continental", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "EC");

    expect(timezoneLabels()).toEqual([
      "Ecuador — Continental (Quito, Guayaquil)",
      "Ecuador — Galápagos",
    ]);
  });

  // Los 19 países curados restantes tienen UNA sola zona: se ofrece sola y
  // preseleccionada. Incluye la cobertura original de "ya no ofrece la
  // entrada regional 'Sudamérica (UTC-4)': La Paz ahora es Bolivia" (fila BO).
  const SINGLE_ZONE_COUNTRIES: ReadonlyArray<readonly [string, string, string]> = [
    ["BZ", "America/Belize", "Belice (Belmopán)"],
    ["CR", "America/Costa_Rica", "Costa Rica (San José)"],
    ["SV", "America/El_Salvador", "El Salvador (San Salvador)"],
    ["GT", "America/Guatemala", "Guatemala (Ciudad de Guatemala)"],
    ["HN", "America/Tegucigalpa", "Honduras (Tegucigalpa)"],
    ["NI", "America/Managua", "Nicaragua (Managua)"],
    ["PA", "America/Panama", "Panamá (Ciudad de Panamá)"],
    ["AR", "America/Argentina/Buenos_Aires", "Argentina (Buenos Aires)"],
    ["BO", "America/La_Paz", "Bolivia (La Paz)"],
    ["CO", "America/Bogota", "Colombia (Bogotá)"],
    ["PY", "America/Asuncion", "Paraguay (Asunción)"],
    ["PE", "America/Lima", "Perú (Lima)"],
    ["UY", "America/Montevideo", "Uruguay (Montevideo)"],
    ["VE", "America/Caracas", "Venezuela (Caracas)"],
    ["PT", "Europe/Lisbon", "Portugal (Lisboa)"],
    ["FR", "Europe/Paris", "Francia (París)"],
    ["IT", "Europe/Rome", "Italia (Roma, Milán)"],
    ["DE", "Europe/Berlin", "Alemania (Berlín, Múnich)"],
    ["GB", "Europe/London", "Reino Unido — Inglaterra (Londres)"],
  ];

  it.each(SINGLE_ZONE_COUNTRIES)(
    "país de una sola zona (%s): la ofrece sola y preseleccionada",
    async (code, tz, label) => {
      const user = userEvent.setup();
      renderStep();
      await selectCountry(user, code);

      expect(timezoneValues()).toEqual([tz]);
      expect(timezoneLabels()).toEqual([label]);
      expect(timezoneSelect().value).toBe(tz);
    },
  );

  it("conserva el default del tenant (America/Mexico_City) seleccionado", () => {
    renderStep();
    expect(timezoneSelect().value).toBe("America/Mexico_City");
  });

  // Decisión 7: cambiar de país RE-DERIVA la zona horaria.
  it("si la zona actual NO pertenece al país curado nuevo, se resetea a elegir (país con varias zonas)", async () => {
    const user = userEvent.setup();
    renderStep({ country: "MX", timezone: "America/Mexico_City" });
    await selectCountry(user, "US");

    expect(timezoneSelect().value).toBe("");
  });

  it("si la zona actual SÍ pertenece al país curado nuevo, se conserva (sin resetear)", async () => {
    const user = userEvent.setup();
    // Tenant sin país aún, con el timezone default del backend — elegir
    // México por primera vez conserva ese default porque YA está entre sus
    // cuatro zonas curadas.
    renderStep({ country: null, timezone: "America/Mexico_City" });
    await selectCountry(user, "MX");

    expect(timezoneSelect().value).toBe("America/Mexico_City");
  });

  it("país curado de una sola zona: la actual se reemplaza por la única del país nuevo", async () => {
    const user = userEvent.setup();
    renderStep({ country: "MX", timezone: "America/Mexico_City" });
    await selectCountry(user, "FR");

    expect(timezoneSelect().value).toBe("Europe/Paris");
  });
});

describe("StepBusiness — zonas horarias, país NO curado (fuera del catálogo de 26)", () => {
  it("ofrece el catálogo IANA completo con la zona del navegador preseleccionada (mockeada)", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "Asia/Tokyo" } as Intl.ResolvedDateTimeFormatOptions);

    try {
      renderStep();
      await selectCountry(user, "JP");

      expect(timezoneSelect().value).toBe("Asia/Tokyo");
      // Catálogo completo, no el curado: trae zonas de PAÍSES curados
      // (identificador IANA tal cual, sin traducir) y bastantes más de 45.
      expect(timezoneValues().length).toBeGreaterThan(45);
      expect(timezoneValues()).toContain("Europe/Madrid");
      expect(timezoneLabels()).toContain("Europe/Madrid");
    } finally {
      spy.mockRestore();
    }
  });

  it("si la zona del navegador no es detectable/válida, queda sin elegir", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "Not/AZone" } as Intl.ResolvedDateTimeFormatOptions);

    try {
      renderStep();
      await selectCountry(user, "JP");

      expect(timezoneSelect().value).toBe("");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("StepBusiness — etiqueta fiscal dinámica (MERCADOS.md §2, RESUELTO)", () => {
  it("México: 'Identificación fiscal (RFC)'", () => {
    renderStep({ country: "MX" });
    expect(screen.getByLabelText("Identificación fiscal (RFC)")).toBeInTheDocument();
  });

  it("Chile: 'Identificación fiscal (RUT)' — YA NO es la etiqueta genérica de todo el form", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "CL");

    expect(screen.getByLabelText("Identificación fiscal (RUT)")).toBeInTheDocument();
  });

  it("país NO curado (Japón): etiqueta genérica sin sigla, nunca miente un país que no soportamos", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "JP");

    expect(screen.getByLabelText("Identificación fiscal")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Identificación fiscal \(/)).not.toBeInTheDocument();
  });
});

describe("StepBusiness — moneda: preselección editable por país (decisión 5)", () => {
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

  it("cambiar a Alemania re-preselecciona EUR automáticamente", async () => {
    const user = userEvent.setup();
    renderStep({ country: "MX", currency: "MXN" });
    await selectCountry(user, "DE");

    expect((screen.getByLabelText("Moneda operacional") as HTMLSelectElement).value).toBe("EUR");
  });

  it("cambiar a un país sudamericano re-preselecciona USD (decisión operativa, MERCADOS.md §1)", async () => {
    const user = userEvent.setup();
    renderStep({ country: "MX", currency: "MXN" });
    await selectCountry(user, "AR");

    expect((screen.getByLabelText("Moneda operacional") as HTMLSelectElement).value).toBe("USD");
  });

  it("si el usuario YA tocó la moneda a mano, cambiar de país no la vuelve a re-preseleccionar", async () => {
    const user = userEvent.setup();
    renderStep({ country: "MX", currency: "MXN" });

    await user.selectOptions(screen.getByLabelText("Moneda operacional"), "GBP");
    await selectCountry(user, "DE"); // normalmente re-preseleccionaría EUR

    expect((screen.getByLabelText("Moneda operacional") as HTMLSelectElement).value).toBe("GBP");
  });

  it("la línea 'moneda no disponible' siempre está visible, junto a la de inmutabilidad", () => {
    renderStep();
    expect(
      screen.getByText(
        "No vas a poder cambiar la moneda una vez que registres tu primer movimiento.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("¿Necesitas otra moneda? Escríbenos y la habilitamos."),
    ).toBeInTheDocument();
  });
});
