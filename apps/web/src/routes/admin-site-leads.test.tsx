import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as siteApi from "@/lib/site/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F11-SITE-LEAD-08 — «Prospectos del sitio»: la lista de solo lectura de
 * quien llenó el formulario de `sellpointy.com`, con la red del «Sin
 * avisar» para el día que un correo no llegue.
 */
vi.mock("@/lib/site/api", () => ({
  getSiteLeads: vi.fn(),
}));

const mockedLeads = vi.mocked(siteApi.getSiteLeads);

const demoUser = (isPlatformAdmin: boolean): AuthUser =>
  buildAuthUser({
    email: "admin@example.com",
    firstName: "Carlos",
    lastName: "H",
    permissions: ["tenants:manage"],
    isPlatformAdmin,
    tenant: buildTenantBlock({ name: "SellPointy HQ" }),
  });

async function renderLeads(isPlatformAdmin = true) {
  useAuthStore.getState().setAuth("jwt", demoUser(isPlatformAdmin));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/admin/site/leads"] }),
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

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("«Prospectos del sitio» (F11-SITE-LEAD-08)", () => {
  beforeEach(() => {
    mockedLeads.mockResolvedValue({
      items: [
        {
          id: "lead-1",
          createdAt: "2026-09-10T18:30:00.000Z",
          name: "Ana Pérez",
          email: "ana@example.com",
          country: "MX",
          route: "es-mx",
          planInterest: "plus",
          businessType: "Consultorio dental",
          message: "Me interesa saber más del módulo de recepción.",
          notified: true,
        },
        {
          id: "lead-2",
          createdAt: "2026-09-11T12:00:00.000Z",
          name: "Bob Smith",
          email: "bob@example.com",
          country: "US",
          route: "en-us",
          planInterest: "undecided",
          businessType: null,
          message: null,
          notified: false,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
  });

  it("el menú Backoffice tiene «Prospectos del sitio» y la lista se ve con su mensaje y el aviso", async () => {
    await renderLeads();

    const grupo = await screen.findByRole("group", { name: "Backoffice" });
    expect(within(grupo).getByRole("link", { name: "Prospectos del sitio" })).toHaveAttribute(
      "href",
      "/admin/site/leads",
    );

    const filaAvisada = await screen.findByTestId("site-lead-lead-1");
    expect(within(filaAvisada).getByText("Ana Pérez")).toBeInTheDocument();
    expect(
      within(filaAvisada).getByText("Me interesa saber más del módulo de recepción."),
    ).toBeInTheDocument();
    expect(within(filaAvisada).getByRole("link", { name: "ana@example.com" })).toHaveAttribute(
      "href",
      "mailto:ana@example.com",
    );
    expect(within(filaAvisada).getByText("Plus")).toBeInTheDocument();
    expect(within(filaAvisada).getByText("Avisado")).toBeInTheDocument();

    // Sin avisar: la red del día que un correo no llegue tiene que saltar a la vista.
    const filaSinAvisar = screen.getByTestId("site-lead-lead-2");
    expect(within(filaSinAvisar).getByText("Sin avisar")).toBeInTheDocument();
    expect(within(filaSinAvisar).getByText("Todavía no sé")).toBeInTheDocument();
  });

  it("sin el flag, ni el link ni la página", async () => {
    const router = await renderLeads(false);
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByRole("link", { name: "Prospectos del sitio" })).not.toBeInTheDocument();
  });

  it("sin resultados en el rango, se ve una frase y no una tabla vacía", async () => {
    mockedLeads.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    await renderLeads();

    expect(await screen.findByText("Todavía no hay prospectos en este rango.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("elegir un rango de fechas vuelve a pedir la lista con `from` y `to`", async () => {
    await renderLeads();
    await screen.findByTestId("site-lead-lead-1");

    // `fireEvent.change` y no `userEvent.type`: en un `<input type="date">`
    // CONTROLADO, teclear carácter por carácter produce valores parciales.
    fireEvent.change(screen.getByLabelText(/Desde/i), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText(/Hasta/i), { target: { value: "2026-09-15" } });

    await waitFor(() => {
      expect(mockedLeads).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-09-01", to: "2026-09-15", page: 1 }),
      );
    });
  });

  it("un error de carga se ve como alerta", async () => {
    mockedLeads.mockRejectedValue({
      statusCode: 403,
      message: "No pudimos cargar los prospectos.",
    });
    await renderLeads();

    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos cargar/);
  });
});
