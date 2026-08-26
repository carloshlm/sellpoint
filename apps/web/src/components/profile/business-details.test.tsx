import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as tenantApi from "@/lib/tenant/api";
import type { AuthUser } from "@/stores/auth.store";
import { BusinessDetails } from "./business-details";

/**
 * Datos del negocio en "Mi perfil" (Carlos, 2026-08-25).
 *
 * Los datos que el wizard capturó una vez (nombre legal, identificación
 * fiscal, dirección) no pueden quedar atrapados ahí: el wizard corre UNA vez
 * y los negocios cambian de domicilio. Esta tarjeta es la puerta de edición
 * permanente — el wizard no se toca.
 */
vi.mock("@/lib/tenant/api", async (importOriginal) => ({
  ...(await importOriginal<typeof tenantApi>()),
  updateMyTenant: vi.fn(),
}));
vi.mock("@/lib/auth/session-resync", () => ({
  resyncSession: vi.fn().mockResolvedValue(undefined),
}));

const mockedUpdate = vi.mocked(tenantApi.updateMyTenant);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: "Acme SA de CV",
    taxId: "ACM010101AAA",
    address: "Av. Siempre Viva 123",
    phone: "+525512345678",
    theme: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
  },
});

function renderCard(user: AuthUser) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <BusinessDetails user={user} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockedUpdate.mockReset();
});

describe("Datos del negocio en Mi perfil (2026-08-25)", () => {
  /**
   * Mismo criterio que el botón Crear de los movimientos: sin permiso la
   * tarjeta NO EXISTE — deshabilitarla sugeriría que falta un clic, no un
   * permiso.
   */
  it("sin tenants:manage la tarjeta no existe", () => {
    renderCard(demoUser(["users:read"]));

    expect(screen.queryByTestId("business-details")).not.toBeInTheDocument();
  });

  it("con tenants:manage muestra los datos del wizard ya capturados", () => {
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getByLabelText("Nombre del negocio")).toHaveValue("Acme");
    expect(screen.getByLabelText("Nombre legal")).toHaveValue("Acme SA de CV");
    expect(screen.getByLabelText("Identificación fiscal")).toHaveValue("ACM010101AAA");
    expect(screen.getByLabelText("Dirección")).toHaveValue("Av. Siempre Viva 123");
  });

  /**
   * El teléfono compuesto (Carlos, 2026-08-25, segunda pasada): la tarjeta
   * pinta país + número, pero lo GUARDADO es un E.164 canónico. Al abrir, el
   * canónico se descompone de vuelta — y como un dial no identifica país
   * ("1" es todo el NANP), el país del tenant desempata.
   */
  describe("el teléfono se compone de país + número", () => {
    it("el E.164 guardado se descompone: país en el select, nacional en el input", () => {
      renderCard(demoUser(["tenants:manage"]));

      expect(screen.getByLabelText("Código de país")).toHaveValue("MX");
      expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue("5512345678");
    });

    it("sin teléfono guardado, el país del NEGOCIO preselecciona el dial", () => {
      const user = demoUser(["tenants:manage"]);
      user.tenant = { ...user.tenant, phone: null };
      renderCard(user);

      expect(screen.getByLabelText("Código de país")).toHaveValue("MX");
      expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue("");
    });

    it("un dial compartido (+1) se desempata con el país del tenant", () => {
      const user = demoUser(["tenants:manage"]);
      user.tenant = { ...user.tenant, phone: "+15551234567", country: "CA" };
      renderCard(user);

      expect(screen.getByLabelText("Código de país")).toHaveValue("CA");
      expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue("5551234567");
    });

    it("guardar compone el canónico: dial del país elegido + número sin espacios", async () => {
      const user = userEvent.setup();
      const actor = demoUser(["tenants:manage"]);
      actor.tenant = { ...actor.tenant, phone: null };
      mockedUpdate.mockResolvedValue({ ...actor.tenant, phone: "+525598765432" });
      renderCard(actor);

      await user.type(screen.getByLabelText(/Teléfono móvil/), "55 9876 5432");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ phone: "+525598765432" });
      });
    });

    it("cambiar SOLO el país re-compone el número con el dial nuevo", async () => {
      const user = userEvent.setup();
      mockedUpdate.mockResolvedValue(demoUser(["tenants:manage"]).tenant);
      renderCard(demoUser(["tenants:manage"]));

      await user.selectOptions(screen.getByLabelText("Código de país"), "US");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ phone: "+15512345678" });
      });
    });

    it("un número con letras NO se manda: error de validación", async () => {
      const user = userEvent.setup();
      renderCard(demoUser(["tenants:manage"]));

      await user.clear(screen.getByLabelText(/Teléfono móvil/));
      await user.type(screen.getByLabelText(/Teléfono móvil/), "55ABC1234");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      expect(await screen.findByText(/solo dígitos/i)).toBeInTheDocument();
      expect(mockedUpdate).not.toHaveBeenCalled();
    });
  });

  /**
   * País FIJO + zona horaria editable + moneda visible (Carlos, 2026-08-26,
   * segunda pasada). El país dejó de ser editable el mismo día que nació
   * editable: los impuestos por país vienen en el roadmap y un cambio de
   * país los rompería — mismo criterio que congeló la moneda. La zona sí se
   * edita (los negocios se mudan dentro de su país).
   */
  describe("país fijo, zona horaria editable y moneda visible (2026-08-26)", () => {
    it("el país se muestra con su nombre pero NO es un campo editable", () => {
      renderCard(demoUser(["tenants:manage"]));

      expect(screen.getByTestId("business-country")).toHaveTextContent("México");
      expect(screen.queryByRole("combobox", { name: "País" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "País" })).not.toBeInTheDocument();
    });

    it("el país va hasta arriba y la zona horaria después de la dirección", () => {
      renderCard(demoUser(["tenants:manage"]));

      const country = screen.getByTestId("business-country");
      const name = screen.getByLabelText("Nombre del negocio");
      const address = screen.getByLabelText("Dirección");
      const timezone = screen.getByLabelText("Zona horaria");

      // DOCUMENT_POSITION_FOLLOWING = el argumento está DESPUÉS del receptor.
      expect(country.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        address.compareDocumentPosition(timezone) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("la zona llega precargada y solo ofrece las zonas del país del negocio", () => {
      renderCard(demoUser(["tenants:manage"]));

      const timezone = screen.getByLabelText<HTMLSelectElement>("Zona horaria");
      expect(timezone).toHaveValue("America/Mexico_City");
      const values = [...timezone.options].map((option) => option.value).filter(Boolean);
      expect(values).toEqual([
        "America/Mexico_City",
        "America/Cancun",
        "America/Hermosillo",
        "America/Tijuana",
      ]);
    });

    it("la moneda se muestra con su nombre pero NO es un campo editable", () => {
      renderCard(demoUser(["tenants:manage"]));

      expect(screen.getByTestId("business-currency")).toHaveTextContent("Peso mexicano (MXN)");
      expect(screen.queryByRole("combobox", { name: "Moneda" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Moneda" })).not.toBeInTheDocument();
    });

    it("cambiar la zona horaria manda SOLO timezone", async () => {
      const user = userEvent.setup();
      mockedUpdate.mockResolvedValue({
        ...demoUser(["tenants:manage"]).tenant,
        timezone: "America/Cancun",
      });
      renderCard(demoUser(["tenants:manage"]));

      await user.selectOptions(screen.getByLabelText("Zona horaria"), "America/Cancun");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ timezone: "America/Cancun" });
      });
    });
  });

  it("sin cambios el botón Guardar está deshabilitado", () => {
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  /**
   * PATCH parcial DE VERDAD: mandar los cinco campos cuando cambió uno
   * convierte cada guardado en una sobreescritura total — y un admin con la
   * pantalla abierta desde ayer pisaría los cambios de otro sin enterarse.
   */
  it("guardar manda SOLO lo modificado y avisa el éxito", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue(demoUser(["tenants:manage"]).tenant);
    renderCard(demoUser(["tenants:manage"]));

    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "Calle Nueva 456");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // Sobre el PRIMER argumento: React Query le pasa al `mutationFn` un
    // segundo con el contexto de la mutación, que no es asunto del test.
    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ address: "Calle Nueva 456" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/guardados/i);
  });

  /** El teléfono es opcional: vaciar el NÚMERO lo BORRA (null), no manda "". */
  it("vaciar el teléfono lo borra con null", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue({ ...demoUser(["tenants:manage"]).tenant, phone: null });
    renderCard(demoUser(["tenants:manage"]));

    await user.clear(screen.getByLabelText(/Teléfono móvil/));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ phone: null });
    });
  });

  /** Los datos del wizard eran requeridos y lo siguen siendo: no se vacían. */
  it("un campo requerido vaciado NO se manda: error de validación", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    await user.clear(screen.getByLabelText("Nombre del negocio"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Este campo es obligatorio")).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("un error del API se muestra, no se traga", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockRejectedValue({ statusCode: 500, message: "Algo salió mal" });
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText("Nombre del negocio"), " Retail");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
  });
});
