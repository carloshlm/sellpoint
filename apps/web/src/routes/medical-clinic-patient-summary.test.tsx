import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { PatientSummary, RecordSummary } from "@/lib/medical-clinic/api";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { clinicUser, expediente } from "@/test/medical-clinic-fixture";

/**
 * F9-CLINIC-WEB-29 — «Resumen del paciente»: lo que se sabe de la persona y
 * sus historias clínicas, para verlas o continuar la de hoy.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  listRecords: vi.fn(),
  getRecord: vi.fn(),
  getPatient: vi.fn(),
  createRecord: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

const resumen = (over: Partial<PatientSummary> = {}): PatientSummary => ({
  customerId: "c1",
  name: "Rosa Luna Ríos",
  birthDate: "1990-09-02",
  age: 36,
  phone: "+525512345678",
  email: "rosa@example.com",
  notes: "Alérgica a la penicilina",
  generalData: {
    sex: "F",
    occupation: "Docente",
    emergencyContactName: "Luis Luna",
    emergencyContactPhone: "+525587654321",
  },
  recordCount: 2,
  lastRecord: {
    id: "r1",
    folio: "HCL-000010",
    consultationDate: "2026-09-04",
    status: "open",
    lockReason: null,
  },
  ...over,
});

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

async function renderRuta(path = "/medical-clinic/patients/c1") {
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
  return router;
}

beforeEach(() => {
  mocked.getPatient.mockResolvedValue(resumen());
  mocked.listRecords.mockResolvedValue({
    rows: [
      fila(),
      fila({
        id: "r0",
        folio: "HCL-000003",
        status: "closed",
        editable: false,
        lockReason: "closed",
        consultationDate: "2026-08-01",
        createdAt: "2026-08-01T16:00:00.000Z",
      }),
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  mocked.createRecord.mockResolvedValue(expediente({ id: "r9", folio: "HCL-000011" }));
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("«Resumen del paciente» (F9-CLINIC-WEB-29)", () => {
  it("pinta a la persona, sus Datos Generales y sus historias clínicas, pedidas por paciente", async () => {
    await renderRuta();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Rosa Luna Ríos" }),
    ).toBeInTheDocument();
    const ficha = screen.getByTestId("patient-summary");
    expect(ficha).toHaveTextContent("36 años");
    expect(ficha).toHaveTextContent("Femenino");
    expect(ficha).toHaveTextContent("Docente");
    expect(ficha).toHaveTextContent("+525512345678");
    expect(ficha).toHaveTextContent("rosa@example.com");
    expect(ficha).toHaveTextContent("Luis Luna");
    expect(ficha).toHaveTextContent("Alérgica a la penicilina");

    await waitFor(() =>
      expect(mocked.listRecords).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: "c1", page: 1 }),
      ),
    );
    const tabla = await screen.findByRole("table");
    // Todas son del mismo paciente: la columna «Paciente» sobra aquí.
    expect(within(tabla).queryByRole("columnheader", { name: "Paciente" })).not.toBeInTheDocument();
    const filas = within(tabla).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(2);
    expect(
      within(filas[0] as HTMLElement).getByRole("link", { name: "Continuar" }),
    ).toHaveAttribute("href", "/medical-clinic/records/r1");
    expect(within(filas[1] as HTMLElement).getByRole("link", { name: "Abrir" })).toHaveAttribute(
      "href",
      "/medical-clinic/records/r0",
    );
    expect(screen.getByText("2 historias clínicas")).toBeInTheDocument();
  });

  it("con una consulta abierta hoy ofrece continuarla; si no, iniciar una nueva", async () => {
    await renderRuta();
    expect(
      await screen.findByRole("link", { name: "Continuar consulta HCL-000010" }),
    ).toHaveAttribute("href", "/medical-clinic/records/r1");
    expect(screen.queryByRole("button", { name: "Iniciar consulta" })).not.toBeInTheDocument();
  });

  it("sin consulta abierta hoy, «Iniciar consulta» abre un folio nuevo y navega a él", async () => {
    mocked.getPatient.mockResolvedValue(
      resumen({
        lastRecord: {
          id: "r0",
          folio: "HCL-000003",
          consultationDate: "2026-08-01",
          status: "closed",
          lockReason: "closed",
        },
      }),
    );
    const router = await renderRuta();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    await waitFor(() => expect(mocked.createRecord).toHaveBeenCalledWith({ customerId: "c1" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r9"));
  });

  it("sin historias lo dice y los datos que faltan salen como «—»", async () => {
    mocked.getPatient.mockResolvedValue(
      resumen({
        phone: null,
        email: null,
        notes: null,
        generalData: null,
        recordCount: 0,
        lastRecord: null,
      }),
    );
    mocked.listRecords.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    await renderRuta();
    expect(
      await screen.findByText("Este paciente todavía no tiene historias clínicas."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("patient-summary")).toHaveTextContent("—");
  });

  it("si el paciente no existe lo dice con su motivo", async () => {
    mocked.getPatient.mockRejectedValue({
      statusCode: 404,
      message: "El paciente no existe.",
      code: "medical_clinic.patient_not_found",
    });
    await renderRuta();
    expect(await screen.findByRole("alert")).toHaveTextContent("El paciente no existe.");
  });
});
