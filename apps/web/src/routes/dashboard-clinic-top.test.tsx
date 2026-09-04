import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { ClinicTop } from "@/lib/medical-clinic/api";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { clinicUser } from "@/test/medical-clinic-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-CLINIC-WEB-26 — «Lo más vendido del consultorio» en el Panel.
 *
 * Tres listas separadas porque son tres decisiones distintas: qué receta el
 * médico, qué laboratorio se pide y qué estudio de imagen. El top general de
 * productos no las responde: ahí los estudios ni aparecen (no son productos)
 * y el medicamento se mezcla con lo que vende el mostrador.
 */
vi.mock("@/lib/dashboard/api", () => ({
  getDashboardKpis: vi.fn().mockResolvedValue({
    today: { total: "0", tickets: 0, averageTicket: "0", deltaVsLastWeekPct: null },
    month: { total: "0", deltaVsPrevMonthPct: null, goal: null, goalPct: null },
    profit: { month: "0", deltaVsPrevMonthPct: null },
  }),
  getDashboardSeries: vi.fn().mockResolvedValue({ byDay: [], byHour: [] }),
  getDashboardProducts: vi.fn().mockResolvedValue({ topSold: [], topProfit: [] }),
  getDashboardInventory: vi.fn().mockResolvedValue({
    outOfStock: 0,
    belowMin: 0,
    inventoryValue: "0",
    attention: [],
  }),
  getDashboardPayments: vi.fn().mockResolvedValue({ methods: [] }),
}));
vi.mock("@/lib/inventory/api", () => ({ listExpiring: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/medical-clinic/api", () => ({ getClinicTop: vi.fn() }));

const mocked = vi.mocked(clinicApi);

const TOP: ClinicTop = {
  medications: [
    { id: "prod1", code: "PARA500", name: "Paracetamol 500 mg", units: "42", revenue: "1890.00" },
  ],
  labStudies: [
    { id: "lab1", code: "BH", name: "Biometría hemática", units: "17", revenue: "5950.00" },
    { id: "lab2", code: "QS", name: "Química sanguínea", units: "9", revenue: "3780.00" },
  ],
  diagnosticStudies: [
    { id: "dx1", code: "RX-TX", name: "Radiografía de tórax", units: "4", revenue: "2400.00" },
  ],
};

async function renderPanel(user = clinicUser(["medical_clinic:read"])) {
  useAuthStore.getState().setAuth("jwt-demo", user);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
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

beforeEach(() => {
  mocked.getClinicTop.mockResolvedValue(TOP);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("«Lo más vendido del consultorio» en el Panel (F9-CLINIC-WEB-26)", () => {
  it("con el módulo y el permiso, pinta las tres listas con lo que trae el API", async () => {
    await renderPanel();
    const tarjeta = await screen.findByTestId("clinic-top");
    const medicamentos = within(tarjeta).getByRole("region", { name: "Medicamentos" });
    expect(medicamentos).toHaveTextContent("Paracetamol 500 mg");
    expect(medicamentos).toHaveTextContent("42 unidades");
    const laboratorio = within(tarjeta).getByRole("region", { name: "Laboratorio" });
    expect(within(laboratorio).getAllByRole("listitem")).toHaveLength(2);
    expect(laboratorio).toHaveTextContent("Biometría hemática");
    const diagnostico = within(tarjeta).getByRole("region", { name: "Diagnóstico" });
    expect(diagnostico).toHaveTextContent("Radiografía de tórax");
    // Cuatro estudios son «unidades»; uno es «unidad». El plural se ve raro
    // justo en la fila que más se repite: la del estudio que se pidió una vez.
    expect(diagnostico).toHaveTextContent("4 unidades");
    expect(within(tarjeta).getByRole("region", { name: "Laboratorio" })).toHaveTextContent(
      "9 unidades",
    );
    // El período del panel arranca en «mes» y gobierna también esta tarjeta.
    expect(mocked.getClinicTop).toHaveBeenCalledWith("month");
  });

  it("sin el módulo no se pinta y NO se llama al API", async () => {
    await renderPanel({
      ...clinicUser(["medical_clinic:read"]),
      subscription: { ...SUBSCRIPTION_PLUS, modules: [] },
    });
    await screen.findByTestId("dashboard-title");
    expect(screen.queryByTestId("clinic-top")).not.toBeInTheDocument();
    expect(mocked.getClinicTop).not.toHaveBeenCalled();
  });

  it("con el módulo pero sin permiso de lectura tampoco se pinta ni se llama", async () => {
    await renderPanel(clinicUser(["medical_clinic:attend"]));
    await screen.findByTestId("dashboard-title");
    expect(screen.queryByTestId("clinic-top")).not.toBeInTheDocument();
    expect(mocked.getClinicTop).not.toHaveBeenCalled();
  });

  it("cambiar el período vuelve a pedir con el nuevo", async () => {
    await renderPanel();
    await screen.findByTestId("clinic-top");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Hoy" }));
    await waitFor(() => expect(mocked.getClinicTop).toHaveBeenCalledWith("today"));
  });

  it("una lista sin ventas lo dice, no se queda en blanco", async () => {
    mocked.getClinicTop.mockResolvedValue({ ...TOP, diagnosticStudies: [] });
    await renderPanel();
    const tarjeta = await screen.findByTestId("clinic-top");
    expect(within(tarjeta).getByRole("region", { name: "Diagnóstico" })).toHaveTextContent(
      "Sin ventas en el período",
    );
  });

  it("si el API falla lo dice con su motivo, no finge que no hubo ventas", async () => {
    mocked.getClinicTop.mockRejectedValue({ statusCode: 403, message: "nope", code: "forbidden" });
    await renderPanel();
    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent("No tienes permiso para ver esto.");
  });
});
