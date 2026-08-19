import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import { createQueryClient } from "../lib/query-client";
import * as servicesApi from "../lib/services/api";
import { routeTree } from "../routeTree.gen";

/**
 * F3-SVC-04 — el catálogo de Servicios (CU-CAT-08).
 *
 * Un servicio se vende pero NO mueve inventario: acá no hay almacén, ni
 * presentación, ni lote. Es el CRUD más simple del sistema a propósito.
 */
vi.mock("../lib/services/api", () => ({
  listServices: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  removeService: vi.fn(),
}));

const mockedApi = vi.mocked(servicesApi);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es",
  permissions,
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
  },
});

const servicio = (over: Partial<servicesApi.Service> = {}): servicesApi.Service => ({
  id: "s1",
  code: "CORTE",
  name: "Corte de cabello",
  description: null,
  cost: "40",
  price: "150",
  isActive: true,
  ...over,
});

async function renderServices(permissions = ["services:read", "services:manage"]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/services"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe("Catálogo de servicios (F3-SVC-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listServices.mockResolvedValue([servicio()]);
  });

  it("lista los servicios con su código, nombre y precio", async () => {
    await renderServices();

    expect(await screen.findByText("Corte de cabello")).toBeInTheDocument();
    const fila = screen.getByText("Corte de cabello").closest("tr") as HTMLElement;
    expect(within(fila).getByText("CORTE")).toBeInTheDocument();
    expect(within(fila).getByText("150")).toBeInTheDocument();
  });

  it("crear un servicio manda código, nombre y precio", async () => {
    const user = userEvent.setup();
    mockedApi.createService.mockResolvedValue(servicio());
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Nuevo servicio" }));
    await user.type(screen.getByLabelText("Código"), "TINTE");
    await user.type(screen.getByLabelText("Nombre"), "Tinte");
    await user.type(screen.getByLabelText("Precio"), "300");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      // React Query pasa su contexto como segundo argumento cuando el
      // `mutationFn` es la función del api directamente.
      expect(mockedApi.createService).toHaveBeenCalledWith(
        expect.objectContaining({ code: "TINTE", name: "Tinte", price: 300 }),
        expect.anything(),
      );
    });
  });

  it("desactivar manda isActive:false y no borra nada", async () => {
    const user = userEvent.setup();
    mockedApi.updateService.mockResolvedValue(servicio({ isActive: false }));
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    await waitFor(() => {
      expect(mockedApi.updateService).toHaveBeenCalledWith("s1", { isActive: false });
    });
    expect(mockedApi.removeService).not.toHaveBeenCalled();
  });

  /** Borrar SÍ pide confirmación: es lo único de esta pantalla sin vuelta atrás. */
  it("eliminar pide confirmación antes de mandar el DELETE", async () => {
    const user = userEvent.setup();
    mockedApi.removeService.mockResolvedValue(undefined);
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(mockedApi.removeService).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Eliminar servicio" }));

    await waitFor(() =>
      expect(mockedApi.removeService).toHaveBeenCalledWith("s1", expect.anything()),
    );
  });

  it("el 409 de código repetido se muestra sin romper la tabla", async () => {
    const user = userEvent.setup();
    mockedApi.createService.mockRejectedValue(
      Object.assign(new Error("Ya tienes un servicio con ese código."), { statusCode: 409 }),
    );
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Nuevo servicio" }));
    await user.type(screen.getByLabelText("Código"), "CORTE");
    await user.type(screen.getByLabelText("Nombre"), "Otro corte");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya tienes un servicio con ese código.",
    );
    expect(screen.getByText("Corte de cabello")).toBeInTheDocument();
  });

  it("sin services:manage la pantalla es de solo lectura", async () => {
    await renderServices(["services:read"]);
    await screen.findByText("Corte de cabello");

    expect(screen.queryByRole("button", { name: "Nuevo servicio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });
});
