import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F9-SUPPL-07 — la pantalla de alta y edición de proveedor: en tarjeta (skill
 * `sellpoint-forms`), la etiqueta del registro fiscal según el país del
 * negocio, y un registro repetido que AVISA sin bloquear.
 */
vi.mock("@/lib/suppliers/api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
const mocked = vi.mocked(suppliersApi);

const demoUser = (country: string | null): AuthUser =>
  buildAuthUser({
    permissions: ["suppliers:read", "suppliers:manage"],
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["expenses"] },
    tenant: buildTenantBlock({ country }),
  });

const guardado: suppliersApi.Supplier = {
  id: "s1",
  code: "PROV-001",
  name: "Distribuidora Norte",
  taxId: "DNO900101AB1",
  contactName: null,
  phone: null,
  email: null,
  address: null,
  notes: null,
  isActive: true,
  createdAt: "2026-09-10T18:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
};

async function renderEn(path: string, country: string | null = "MX") {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(country));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

beforeEach(() => {
  mocked.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  mocked.createSupplier.mockResolvedValue(guardado);
  mocked.updateSupplier.mockResolvedValue(guardado);
  mocked.getSupplier.mockResolvedValue(guardado);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("alta y edición de proveedor (F9-SUPPL-07)", () => {
  it("el formulario vive en una tarjeta con su título, y el primer campo en la MISMA tarjeta", async () => {
    await renderEn("/suppliers/new");
    const titulo = await screen.findByRole("heading", { name: "Registrar proveedor" });
    const tarjeta = titulo.closest('[data-slot="card"]');
    expect(tarjeta).not.toBeNull();
    const nombre = screen.getByLabelText(/Nombre o razón social/);
    expect(nombre.closest('[data-slot="card"]')).toBe(tarjeta);
  });

  it("la etiqueta del registro fiscal cambia con el país del negocio", async () => {
    await renderEn("/suppliers/new", "MX");
    expect(await screen.findByLabelText("Registro fiscal (RFC)")).toBeInTheDocument();
    expect(screen.getByText("Por ejemplo ABC010101AB1")).toBeInTheDocument();
  });

  it("sin país del negocio la etiqueta es genérica y no hay ejemplo", async () => {
    await renderEn("/suppliers/new", null);
    expect(await screen.findByLabelText("Registro fiscal")).toBeInTheDocument();
    expect(screen.queryByText(/Por ejemplo/)).not.toBeInTheDocument();
  });

  it("un nombre vacío no dispara la mutación; con nombre, crea y vuelve al listado", async () => {
    const router = await renderEn("/suppliers/new");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Registrar proveedor" });
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este campo es obligatorio.");
    expect(mocked.createSupplier).not.toHaveBeenCalled();

    // F9-SUPPCAT-04: el código se teclea en minúsculas y viaja en MAYÚSCULAS.
    await user.type(screen.getByLabelText("Código"), "norte-01");
    await user.type(screen.getByLabelText(/Nombre o razón social/), "Distribuidora Norte");
    await user.type(screen.getByLabelText("Registro fiscal (RFC)"), "dno900101ab1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createSupplier).toHaveBeenCalledWith({
        code: "NORTE-01",
        name: "Distribuidora Norte",
        taxId: "DNO900101AB1",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/suppliers"));
  });

  it("un RFC mal formado en México se rechaza antes de llamar al API, con el ejemplo", async () => {
    await renderEn("/suppliers/new", "MX");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nombre o razón social/), "Norte");
    await user.type(screen.getByLabelText("Registro fiscal (RFC)"), "NOPE");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("como ABC010101AB1");
    expect(mocked.createSupplier).not.toHaveBeenCalled();
  });

  it("un registro fiscal repetido AVISA al salir del campo y no impide guardar", async () => {
    mocked.listSuppliers.mockResolvedValue({
      rows: [{ ...guardado, id: "s9", name: "Norte (el otro)" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderEn("/suppliers/new", "MX");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nombre o razón social/), "Norte");
    await user.type(screen.getByLabelText("Registro fiscal (RFC)"), "dno900101ab1");
    await user.tab();
    const aviso = await screen.findByTestId("duplicate-supplier");
    expect(aviso).toHaveTextContent("Ya hay 1 proveedor con este registro fiscal");
    expect(within(aviso).getByText("Norte (el otro)")).toBeInTheDocument();
    expect(within(aviso).getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      "/suppliers/s9",
    );
    // Se comprobó con el valor NORMALIZADO, que es como está guardado.
    expect(mocked.listSuppliers).toHaveBeenCalledWith(
      expect.objectContaining({ query: "DNO900101AB1" }),
    );

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocked.createSupplier).toHaveBeenCalled());
  });

  it("editar manda al PATCH solo lo que cambió, incluido retirarlo", async () => {
    const router = await renderEn("/suppliers/s1");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Editar proveedor" });
    const contacto = await screen.findByLabelText("Persona de contacto");
    await user.type(contacto, "Luis Gómez");
    await user.click(screen.getByRole("checkbox", { name: "Proveedor activo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateSupplier).toHaveBeenCalledWith("s1", {
        contactName: "Luis Gómez",
        isActive: false,
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/suppliers"));
  });
});
