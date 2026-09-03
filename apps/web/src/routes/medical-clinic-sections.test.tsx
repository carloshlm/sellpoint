import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { clinicUser, expediente } from "@/test/medical-clinic-fixture";

/**
 * F9-CLINIC-WEB-13/14/15 — la ruta de sección: registro de formularios,
 * redirección si la clave no es funcional, y los tres formularios que
 * guardan SOLO lo capturado y vuelven al tablero.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  getRecord: vi.fn(),
  closeRecord: vi.fn(),
  saveSection: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

async function renderSection(key: string, record = expediente()) {
  mocked.getRecord.mockResolvedValue(record);
  useAuthStore
    .getState()
    .setAuth("jwt-demo", clinicUser(["medical_clinic:read", "medical_clinic:attend"]));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/medical-clinic/records/r1/sections/${key}`],
    }),
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
  mocked.saveSection.mockImplementation((_id, key, data) =>
    Promise.resolve({
      key,
      status: Object.keys(data).length ? "completed" : "pending",
      data,
      updatedAt: null,
    }),
  );
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("ruta de sección (F9-CLINIC-WEB-13)", () => {
  it("una clave sin formulario o desconocida redirige al tablero", async () => {
    const router = await renderSection("allergies");
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
    const otro = await renderSection("no_existe");
    await waitFor(() => expect(otro.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });

  it("Datos Generales pinta el h1 en la tarjeta; Cancelar vuelve sin guardar", async () => {
    const router = await renderSection("general_data");
    const titulo = await screen.findByRole("heading", { level: 1, name: "Datos Generales" });
    expect(titulo.closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "← Historia clínica HCL-000010" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
    expect(mocked.saveSection).not.toHaveBeenCalled();
  });

  it("con la consulta cerrada el formulario es de solo lectura", async () => {
    await renderSection(
      "general_data",
      expediente({ status: "closed", closedAt: "2026-09-03T19:00:00.000Z" }),
    );
    expect(
      await screen.findByText("La consulta está cerrada: esta sección es de solo lectura."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });
});

describe("Datos Generales (F9-CLINIC-WEB-14)", () => {
  it("guarda solo lo capturado y vuelve al tablero", async () => {
    const router = await renderSection("general_data");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Sexo"), "F");
    await user.type(screen.getByLabelText("Ocupación"), "Docente");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "general_data", {
        sex: "F",
        occupation: "Docente",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });

  it("todo vacío manda un objeto sin claves", async () => {
    await renderSection("general_data");
    await userEvent.click(await screen.findByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocked.saveSection).toHaveBeenCalledWith("r1", "general_data", {}));
  });

  it("un teléfono inválido muestra el error y no envía", async () => {
    await renderSection("general_data");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Teléfono del contacto"), "abc");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocked.saveSection).not.toHaveBeenCalled();
  });

  it("precarga lo ya guardado", async () => {
    await renderSection(
      "general_data",
      expediente({}, { general_data: { sex: "M", occupation: "Chofer" } }),
    );
    expect(await screen.findByLabelText("Sexo")).toHaveValue("M");
    expect(screen.getByLabelText("Ocupación")).toHaveValue("Chofer");
  });
});

describe("Motivo y Padecimiento (F9-CLINIC-WEB-15)", () => {
  it("el motivo guarda complaint, onsetValue y onsetUnit", async () => {
    await renderSection("chief_complaint");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Motivo de consulta"), "Dolor de garganta");
    await user.type(screen.getByLabelText("Tiempo de evolución"), "3");
    await user.selectOptions(screen.getByLabelText("Unidad"), "days");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "chief_complaint", {
        complaint: "Dolor de garganta",
        onsetValue: 3,
        onsetUnit: "days",
      }),
    );
  });

  it("el padecimiento no acepta fecha futura y sin fecha no manda startDate", async () => {
    await renderSection("current_illness");
    const user = userEvent.setup();
    const fecha = await screen.findByLabelText("Fecha de inicio");
    expect(fecha).toHaveAttribute("max");
    expect(fecha.getAttribute("max")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await user.type(screen.getByLabelText("Padecimiento actual"), "Inicia hace 3 días…");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "current_illness", {
        narrative: "Inicia hace 3 días…",
      }),
    );
  });
});

/** F9-CLINIC-WEB-24 — la sección de una consulta vencida es de solo lectura. */
describe("sección de una consulta vencida", () => {
  it("avisa que es de otro día y no ofrece Guardar", async () => {
    await renderSection(
      "general_data",
      expediente({ status: "open", editable: false, lockReason: "expired" }),
    );
    expect(
      await screen.findByText("Esta consulta es de otro día: esta sección es de solo lectura."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });

  it("si el día cambia mientras se captura, el error no borra lo tecleado", async () => {
    mocked.saveSection.mockRejectedValue({
      statusCode: 409,
      code: "medical_clinic.record_expired",
      message: "Esa consulta es de otro día: ya no se puede capturar. Abre una consulta nueva.",
    });
    await renderSection("chief_complaint");
    const user = userEvent.setup();
    const motivo = await screen.findByLabelText("Motivo de consulta");
    await user.type(motivo, "Dolor de garganta");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esa consulta es de otro día: ya no se puede capturar. Abre una consulta nueva.",
    );
    expect(motivo).toHaveValue("Dolor de garganta");
  });
});
