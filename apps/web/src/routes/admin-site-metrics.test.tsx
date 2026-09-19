import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as siteApi from "@/lib/site/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F11-SITE-LEAD-09 — «Números del sitio»: los cinco eventos, la tasa de
 * conversión del formulario y de dónde llegan los que sí convierten. Sin
 * gráficas — la tarea pide tablas y las gráficas «cuando hagan falta».
 */
vi.mock("@/lib/site/api", () => ({
  getSiteEventsSummary: vi.fn(),
}));

const mockedSummary = vi.mocked(siteApi.getSiteEventsSummary);

const demoUser = (isPlatformAdmin: boolean): AuthUser =>
  buildAuthUser({
    email: "carls.hlm@gmail.com",
    firstName: "Carlos",
    lastName: "H",
    permissions: ["tenants:manage"],
    isPlatformAdmin,
    tenant: buildTenantBlock({ name: "SellPointy HQ" }),
  });

async function renderMetrics(isPlatformAdmin = true) {
  useAuthStore.getState().setAuth("jwt", demoUser(isPlatformAdmin));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/admin/site/metrics"] }),
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

describe("«Números del sitio» (F11-SITE-LEAD-09)", () => {
  beforeEach(() => {
    mockedSummary.mockResolvedValue({
      from: "2026-08-19",
      to: "2026-09-18",
      byEvent: {
        cta_click: 40,
        form_open: 20,
        form_submit: 10,
        market_change: 3,
        plans_expand: 5,
      },
      byMarket: { mx: 30, us: 10, ca: 5 },
      formOpenToSubmitRate: 0.5,
      topReferrers: [{ domain: "google.com", formSubmit: 6, ctaClick: 8, total: 14 }],
    });
  });

  it("el menú Backoffice tiene «Números del sitio» y se ven los cinco eventos, el mercado y la tasa", async () => {
    await renderMetrics();

    const grupo = await screen.findByRole("group", { name: "Backoffice" });
    expect(within(grupo).getByRole("link", { name: "Números del sitio" })).toHaveAttribute(
      "href",
      "/admin/site/metrics",
    );

    const eventos = await screen.findByTestId("site-metrics-events");
    expect(within(eventos).getByText("Clic en «Empieza gratis»")).toBeInTheDocument();
    expect(within(eventos).getByText("40")).toBeInTheDocument();
    expect(within(eventos).getByText("Abrió el formulario")).toBeInTheDocument();
    expect(within(eventos).getByText("20")).toBeInTheDocument();
    expect(within(eventos).getByText("Envió el formulario")).toBeInTheDocument();
    expect(within(eventos).getByText("Cambió de país o idioma")).toBeInTheDocument();
    expect(within(eventos).getByText("Abrió la comparativa de planes")).toBeInTheDocument();

    const porMercado = screen.getByTestId("site-metrics-by-market");
    expect(within(porMercado).getByText("México")).toBeInTheDocument();
    expect(within(porMercado).getByText("30")).toBeInTheDocument();

    // La tasa que importa: de cada 100 que abren el formulario, cuántos lo envían.
    expect(screen.getByText("50.0%")).toBeInTheDocument();

    // De dónde llegan los que convierten.
    const referidos = screen.getByTestId("site-metrics-referrers");
    expect(within(referidos).getByText("google.com")).toBeInTheDocument();
    expect(within(referidos).getByText("14")).toBeInTheDocument();
  });

  it("sin nadie que haya abierto el formulario, se dice con una frase (nunca 0 % ni NaN)", async () => {
    mockedSummary.mockResolvedValue({
      from: "2026-08-19",
      to: "2026-09-18",
      byEvent: { cta_click: 2, form_open: 0, form_submit: 0, market_change: 0, plans_expand: 0 },
      byMarket: { mx: 1, us: 0, ca: 0 },
      formOpenToSubmitRate: null,
      topReferrers: [],
    });
    await renderMetrics();

    expect(await screen.findByText("Todavía nadie ha abierto el formulario.")).toBeInTheDocument();
    expect(screen.queryByText("0 %")).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText("Todavía no hay datos de referencia.")).toBeInTheDocument();
  });

  it("filtrar por mercado pide el resumen con ese mercado", async () => {
    await renderMetrics();
    await screen.findByText("Clic en «Empieza gratis»");
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Mercado"), "mx");

    await waitFor(() => {
      expect(mockedSummary).toHaveBeenCalledWith(expect.objectContaining({ market: "mx" }));
    });
  });

  it("sin el flag, ni el link ni la página", async () => {
    const router = await renderMetrics(false);
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByRole("link", { name: "Números del sitio" })).not.toBeInTheDocument();
  });

  it("un error de carga se ve como alerta", async () => {
    mockedSummary.mockRejectedValue({
      statusCode: 403,
      message: "No pudimos cargar los números del sitio.",
    });
    await renderMetrics();

    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos cargar/);
  });
});
