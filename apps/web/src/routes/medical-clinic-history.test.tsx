import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { RecordSummary } from "@/lib/medical-clinic/api";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { clinicUser } from "@/test/medical-clinic-fixture";

/**
 * F9-CLINIC-WEB-28 — el buscador de historias clínicas.
 *
 * Abre con las consultas de HOY (del negocio), de la más reciente a la más
 * antigua; se busca por nombre y se acota por fechas; la tabla es la de la
 * casa (encabezado con fondo, fila resaltada) y cada fila abre su expediente.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  listRecords: vi.fn(),
  getRecord: vi.fn(),
  getPatient: vi.fn(),
  createRecord: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

const fila = (over: Partial<RecordSummary> = {}): RecordSummary => ({
  id: "r1",
  folio: "HCL-000010",
  status: "open",
  editable: true,
  lockReason: null,
  consultationDate: "2026-09-04",
  patientName: "Rosa Luna Ríos",
  doctorName: "Ana Pérez",
  createdAt: "2026-09-04T16:00:00.000Z",
  ...over,
});

async function renderRuta(path = "/medical-clinic/records") {
  useAuthStore.getState().setAuth("jwt-demo", clinicUser(["medical_clinic:attend"]));
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
}

beforeEach(() => {
  // El día del negocio (America/Mexico_City) es el 4 de septiembre.
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-04T18:00:00.000Z") });
  mocked.listRecords.mockResolvedValue({
    rows: [
      fila(),
      fila({
        id: "r2",
        folio: "HCL-000009",
        status: "closed",
        editable: false,
        lockReason: "closed",
        patientName: "Bruno Sosa",
        createdAt: "2026-09-04T15:00:00.000Z",
      }),
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  });
});

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("el buscador de historias clínicas (F9-CLINIC-WEB-28)", () => {
  it("abre con las consultas de HOY del negocio y las pinta en la tabla de la casa", async () => {
    await renderRuta();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Historias clínicas" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.listRecords).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-09-04", to: "2026-09-04", page: 1 }),
      ),
    );
    const tabla = await screen.findByRole("table");
    expect(within(tabla).getByRole("columnheader", { name: "Folio" })).toBeInTheDocument();
    expect(within(tabla).getByRole("columnheader", { name: "Paciente" })).toBeInTheDocument();
    expect(within(tabla).getByRole("columnheader", { name: "Médico" })).toBeInTheDocument();
    const filas = within(tabla).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent("HCL-000010");
    expect(filas[0]).toHaveTextContent("Rosa Luna Ríos");
    expect(filas[0]).toHaveTextContent("Abierta");
    expect(filas[1]).toHaveTextContent("Cerrada");
    // Cada fila lleva a su expediente.
    expect(
      within(filas[0] as HTMLElement).getByRole("link", { name: "Continuar" }),
    ).toHaveAttribute("href", "/medical-clinic/records/r1");
    expect(within(filas[1] as HTMLElement).getByRole("link", { name: "Abrir" })).toHaveAttribute(
      "href",
      "/medical-clinic/records/r2",
    );
  });

  it("buscar por nombre y cambiar las fechas vuelve a pedir con los filtros nuevos", async () => {
    await renderRuta();
    await screen.findByRole("table");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre del paciente"), "luna");
    await waitFor(() =>
      expect(mocked.listRecords).toHaveBeenCalledWith(
        expect.objectContaining({ query: "luna", from: "2026-09-04", to: "2026-09-04" }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-08-01" } });
    await waitFor(() =>
      expect(mocked.listRecords).toHaveBeenCalledWith(
        expect.objectContaining({ query: "luna", from: "2026-08-01", to: "2026-09-04" }),
      ),
    );
  });

  it("sin resultados lo dice, no deja una tabla vacía", async () => {
    mocked.listRecords.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    await renderRuta();
    expect(
      await screen.findByText("No hay historias clínicas con esos filtros."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("si el API falla lo dice con su motivo", async () => {
    mocked.listRecords.mockRejectedValue({ statusCode: 403, message: "nope", code: "forbidden" });
    await renderRuta();
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para ver esto.");
  });
});
