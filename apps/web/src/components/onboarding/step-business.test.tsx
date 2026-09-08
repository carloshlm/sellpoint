import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { TenantBlock } from "@/lib/tenant/api";
import { buildTenantBlock } from "@/test/tenant-fixture";
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
  return buildTenantBlock({
    legalName: "Acme SA de CV",
    taxId: "ACM010101AAA",
    address: "Av. Siempre Viva 123",
    onboarded: false,
    ...overrides,
  });
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
  // Se afirma por identificador IANA, no por etiqueta: lo que este test
  // protege es el FILTRADO por país (que no se cuele la zona de otro), no el
  // copy. Así, cambiar una etiqueta no rompe la suite, pero romper el filtro
  // sí. La cobertura de etiquetas vive en un único test más abajo.
  const MULTI_ZONE_COUNTRIES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["MX", ["America/Mexico_City", "America/Cancun", "America/Hermosillo", "America/Tijuana"]],
    [
      "US",
      [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Phoenix",
        "America/Los_Angeles",
        "America/Anchorage",
        "Pacific/Honolulu",
      ],
    ],
    [
      "CA",
      [
        "America/St_Johns",
        "America/Halifax",
        "America/Toronto",
        "America/Winnipeg",
        "America/Edmonton",
        "America/Vancouver",
      ],
    ],
    // Los archipiélagos van aparte del continente porque su offset difiere.
    ["ES", ["Europe/Madrid", "Atlantic/Canary"]],
    ["BR", ["America/Sao_Paulo", "America/Manaus", "America/Rio_Branco"]],
    ["CL", ["America/Santiago", "Pacific/Easter"]],
    ["EC", ["America/Guayaquil", "Pacific/Galapagos"]],
  ];

  it.each(MULTI_ZONE_COUNTRIES)(
    "país curado con varias zonas (%s) ofrece SOLO las suyas",
    async (code, zonas) => {
      const user = userEvent.setup();
      renderStep();
      await selectCountry(user, code);

      expect(timezoneValues()).toEqual(zonas);
    },
  );

  it("las zonas curadas se muestran con su etiqueta de i18n, no con el id IANA crudo", () => {
    renderStep(); // fixture en México
    expect(timezoneLabels()[0]).toBe("México — Centro (Ciudad de México)");
  });

  // Los 19 países curados restantes tienen UNA sola zona: se ofrece sola y
  // preseleccionada. Incluye la cobertura original de "ya no ofrece la
  // entrada regional 'Sudamérica (UTC-4)': La Paz ahora es Bolivia" (fila BO).
  const SINGLE_ZONE_COUNTRIES: ReadonlyArray<readonly [string, string]> = [
    ["BZ", "America/Belize"],
    ["CR", "America/Costa_Rica"],
    ["SV", "America/El_Salvador"],
    ["GT", "America/Guatemala"],
    ["HN", "America/Tegucigalpa"],
    ["NI", "America/Managua"],
    ["PA", "America/Panama"],
    ["AR", "America/Argentina/Buenos_Aires"],
    ["BO", "America/La_Paz"],
    ["CO", "America/Bogota"],
    ["PY", "America/Asuncion"],
    ["PE", "America/Lima"],
    ["UY", "America/Montevideo"],
    ["VE", "America/Caracas"],
    ["PT", "Europe/Lisbon"],
    ["FR", "Europe/Paris"],
    ["IT", "Europe/Rome"],
    ["DE", "Europe/Berlin"],
    ["GB", "Europe/London"],
  ];

  it.each(SINGLE_ZONE_COUNTRIES)(
    "país de una sola zona (%s): la ofrece sola y preseleccionada",
    async (code, tz) => {
      const user = userEvent.setup();
      renderStep();
      await selectCountry(user, code);

      expect(timezoneValues()).toEqual([tz]);
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
  // Decisión de Carlos (2026-08-16): el país filtra SIEMPRE que IANA sepa qué
  // zonas tiene, no solo para los 26 curados. Elegir Japón deja Asia/Tokyo,
  // no las 418 del mundo.
  it("filtra a las zonas del país: Japón ofrece solo Asia/Tokyo, preseleccionada", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "JP");

    expect(timezoneValues()).toEqual(["Asia/Tokyo"]);
    expect(timezoneSelect().value).toBe("Asia/Tokyo");
  });

  it("país no curado con varias zonas: ofrece las suyas y ninguna ajena", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "AU");

    const zonas = timezoneValues();
    expect(zonas.length).toBeGreaterThan(1);
    expect(zonas.every((tz) => tz.startsWith("Australia/") || tz.startsWith("Antarctica/"))).toBe(
      true,
    );
    expect(zonas).not.toContain("Europe/Madrid");
  });

  // Regresión: `Intl.supportedValuesOf` devuelve alias LEGACY ("Asia/Calcutta"),
  // así que filtrar el catálogo contra ESA lista borraba países enteros.
  it.each([
    ["IN", "Asia/Kolkata"],
    ["VN", "Asia/Ho_Chi_Minh"],
    ["NP", "Asia/Kathmandu"],
  ])("país con nombre IANA moderno (%s) conserva su zona", async (code, tz) => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, code);

    expect(timezoneValues()).toContain(tz);
  });

  it("preselecciona la zona del navegador si pertenece al país elegido", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "Australia/Perth" } as Intl.ResolvedDateTimeFormatOptions);

    try {
      renderStep();
      await selectCountry(user, "AU");

      expect(timezoneSelect().value).toBe("Australia/Perth");
    } finally {
      spy.mockRestore();
    }
  });

  it("si la zona del navegador no pertenece al país elegido, queda sin elegir", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "Europe/Madrid" } as Intl.ResolvedDateTimeFormatOptions);

    try {
      renderStep();
      await selectCountry(user, "AU");

      expect(timezoneSelect().value).toBe("");
    } finally {
      spy.mockRestore();
    }
  });

  it("país sin zonas en IANA cae al catálogo completo (no deja al usuario sin opciones)", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "BV"); // Isla Bouvet: deshabitada, sin zona propia

    expect(timezoneValues().length).toBeGreaterThan(45);
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
});

/**
 * F4-TAX-18 — la provincia o el estado aparece SOLO para Canadá y Estados
 * Unidos, con su nombre (no el código), es obligatoria ahí y viaja en el
 * submit; cambiar de país la vacía para no arrastrar una región ajena.
 */
describe("StepBusiness — provincia / estado (F4-TAX-18)", () => {
  function regionSelect(label: string) {
    return screen.getByLabelText(label) as HTMLSelectElement;
  }

  it("México la pide como estado POSTAL (F1-ADDR-05), sin hint fiscal, en una lista de 32", () => {
    renderStep();
    expect(screen.queryByLabelText("Provincia o territorio")).not.toBeInTheDocument();
    const estado = regionSelect("Estado");
    expect(within(estado).getAllByRole("option")).toHaveLength(33);
    expect(screen.queryByText(/impuestos de venta/)).not.toBeInTheDocument();
  });

  it("Canadá pide la provincia por su nombre y sin ella no deja continuar; con ella viaja en el submit", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();
    await selectCountry(user, "CA");

    const provincia = regionSelect("Provincia o territorio");
    expect(within(provincia).getByRole("option", { name: "British Columbia" })).toBeInTheDocument();
    await user.selectOptions(timezoneSelect(), "America/Vancouver");

    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect((await screen.findAllByText("Este campo es obligatorio")).length).toBeGreaterThan(0);

    await user.selectOptions(provincia, "BC");
    // F1-ADDR-05: Canadá también pide ciudad y código postal.
    await user.type(screen.getByLabelText("Ciudad o municipio"), "Vancouver");
    await user.type(screen.getByLabelText("Código postal"), "V6B 1A1");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ country: "CA", region: "BC", currency: "CAD" }),
    );
  });

  it("Estados Unidos pide el estado; cambiar de país vacía la región elegida", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "CA");
    await user.selectOptions(regionSelect("Provincia o territorio"), "BC");

    await selectCountry(user, "US");
    const estado = regionSelect("Estado");
    expect(estado.value).toBe("");
    expect(within(estado).getByRole("option", { name: "Texas" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Provincia o territorio")).not.toBeInTheDocument();
  });

  it("un negocio canadiense que ya tiene provincia la ve preseleccionada", () => {
    renderStep({ country: "CA", region: "ON", timezone: "America/Toronto", currency: "CAD" });
    expect(regionSelect("Provincia o territorio").value).toBe("ON");
  });
});

/**
 * F1-ADDR-05 — la dirección completa en el paso 1, con lo que cada país
 * marca como obligatorio, y UN solo select de región (el fiscal de F4-TAX se
 * fundió dentro del bloque de dirección).
 */
describe("StepBusiness — dirección por país (F1-ADDR-05)", () => {
  it("México: sin código postal no continúa; con colonia, CP, ciudad y estado envía los cinco", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect((await screen.findAllByText("Este campo es obligatorio")).length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Colonia"), "Centro");
    await user.type(screen.getByLabelText("Código postal"), "06000");
    await user.type(screen.getByLabelText("Ciudad o municipio"), "Ciudad de México");
    await user.selectOptions(screen.getByLabelText("Estado"), "CMX");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "Av. Siempre Viva 123",
        addressLine2: "Centro",
        city: "Ciudad de México",
        region: "CMX",
        postalCode: "06000",
      }),
    );
  });

  it("un código postal que no cumple la regla del país se marca con un ejemplo y no continúa", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();
    await user.type(screen.getByLabelText("Código postal"), "0600");
    await user.type(screen.getByLabelText("Ciudad o municipio"), "Ciudad de México");
    await user.selectOptions(screen.getByLabelText("Estado"), "CMX");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/código postal válido para tu país, como 02860/),
    ).toBeInTheDocument();
  });

  it("Canadá: el código postal viaja NORMALIZADO, en mayúsculas y con su espacio", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();
    await selectCountry(user, "CA");
    await user.selectOptions(timezoneSelect(), "America/Toronto");
    await user.selectOptions(screen.getByLabelText("Provincia o territorio"), "ON");
    await user.type(screen.getByLabelText("Ciudad o municipio"), "Toronto");
    await user.type(screen.getByLabelText("Código postal"), "m5v3l9");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ country: "CA", region: "ON", postalCode: "M5V 3L9" }),
    );
  });

  it("la contraprueba: en Canadá hay UN solo select de región, no el fiscal más el postal", async () => {
    const user = userEvent.setup();
    renderStep();
    await selectCountry(user, "CA");
    expect(screen.getAllByRole("combobox", { name: "Provincia o territorio" })).toHaveLength(1);
    // Y el hint fiscal de F4-TAX sigue ahí, porque de esa región salen las tasas.
    expect(screen.getByText(/impuestos de venta/)).toBeInTheDocument();
  });

  it("Reino Unido: sin región; con calle, ciudad y código postal envía", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();
    await selectCountry(user, "GB");
    expect(screen.queryByRole("combobox", { name: /Estado|Provincia/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Ciudad o municipio"), "London");
    await user.type(screen.getByLabelText("Código postal"), "ec1y 8sy");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ country: "GB", region: "", postalCode: "EC1Y 8SY" }),
    );
  });

  it("un país sin formato en el catálogo (Bolivia) sigue como hoy: con la calle basta", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();
    await selectCountry(user, "BO");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ country: "BO", address: "Av. Siempre Viva 123", city: "" }),
    );
  });
});
