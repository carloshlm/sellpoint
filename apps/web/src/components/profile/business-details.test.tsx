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
  locale: "es",
  permissions,
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: "Acme SA de CV",
    taxId: "ACM010101AAA",
    address: "Av. Siempre Viva 123",
    phone: "+52 55 1234 5678",
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
    expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue("+52 55 1234 5678");
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

  /** El teléfono es opcional: vaciarlo lo BORRA (null), no manda "". */
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
