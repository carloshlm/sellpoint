import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { clinicUser, expediente } from "@/test/medical-clinic-fixture";

/**
 * F9-CLINIC-WEB-11/12/16 — el tablero: encabezado con el paciente, cinco
 * grupos, 36 tarjetas (3 funcionales + las de órdenes), estados derivados,
 * resumen solo en las completadas y el cierre con confirmación.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  getRecord: vi.fn(),
  closeRecord: vi.fn(),
  saveSection: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

async function renderRecord(record = expediente()) {
  mocked.getRecord.mockResolvedValue(record);
  useAuthStore
    .getState()
    .setAuth("jwt-demo", clinicUser(["medical_clinic:read", "medical_clinic:attend"]));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/medical-clinic/records/r1"] }),
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

describe("Historia clínica — tablero", () => {
  it("el encabezado trae nombre, folio, edad, médico; sin sexo ofrece completar Datos Generales; 1 de 3", async () => {
    await renderRecord(expediente({}, { chief_complaint: { complaint: "Dolor" } }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Rosa Luna Ríos" }),
    ).toBeInTheDocument();
    const header = screen.getByTestId("record-header");
    expect(header).toHaveTextContent("HCL-000010");
    expect(header).toHaveTextContent("36 años");
    expect(header).toHaveTextContent("Ana Pérez");
    expect(within(header).getByRole("link", { name: "Completa Datos Generales" })).toHaveAttribute(
      "href",
      "/medical-clinic/records/r1/sections/general_data",
    );
    expect(within(header).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(header).toHaveTextContent("1 de 3 secciones capturadas");
  });

  it("cinco grupos en orden, 36 tarjetas, links solo en las funcionales y en órdenes", async () => {
    await renderRecord();
    await screen.findByRole("heading", { level: 1, name: "Rosa Luna Ríos" });
    const grupos = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(grupos).toEqual([
      "Interrogatorio",
      "Exploración",
      "Evaluación y plan",
      "Órdenes médicas",
      "Documentos y seguimiento",
    ]);
    expect(screen.getAllByTestId(/^record-card-/)).toHaveLength(36);
    const links = within(screen.getByTestId("record-groups")).getAllByRole("link");
    // 3 secciones funcionales + 3 órdenes + el listado de órdenes.
    expect(links).toHaveLength(7);
  });

  it("estados: la sección con datos dice Completado y su resumen; el grupo dice En progreso y 1 de 3", async () => {
    await renderRecord(expediente({}, { general_data: { sex: "F", occupation: "Docente" } }));
    const generales = await screen.findByTestId("record-card-general_data");
    expect(generales).toHaveTextContent("Completado");
    expect(generales).toHaveTextContent("Femenino · Docente");
    const motivo = screen.getByTestId("record-card-chief_complaint");
    expect(motivo).toHaveTextContent("Pendiente");
    expect(motivo).not.toHaveTextContent("·");
    const interrogatorio = screen.getByTestId("record-group-interrogation");
    expect(interrogatorio).toHaveTextContent("En progreso");
    expect(interrogatorio).toHaveTextContent("1 de 3");
  });

  it("«Cerrar consulta» pide confirmación y solo entonces llama al API; cerrada, ya no se ofrece", async () => {
    const cerrada = expediente({ status: "closed", closedAt: "2026-09-03T19:00:00.000Z" });
    mocked.closeRecord.mockImplementation(async () => {
      mocked.getRecord.mockResolvedValue(cerrada);
      return cerrada;
    });
    await renderRecord();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cerrar consulta" }));
    expect(mocked.closeRecord).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog", { name: /Cerrar la consulta HCL-000010/ });
    await user.click(within(dialogo).getByRole("button", { name: "Cerrar consulta" }));
    await waitFor(() => expect(mocked.closeRecord).toHaveBeenCalledWith("r1"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Cerrar consulta" })).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("Esta consulta está cerrada: se puede leer, no capturar."),
    ).toBeInTheDocument();
  });
});
