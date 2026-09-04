import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-CLINIC-WEB-07/08 — «Atender paciente»: buscar por nombre o por turno,
 * confirmar con un clic (nunca abrir un expediente solo), y «Paciente
 * nuevo» que da de alta y abre la historia clínica de una vez.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  searchPatients: vi.fn(),
  createPatient: vi.fn(),
  createRecord: vi.fn(),
  getRecord: vi.fn(),
}));
vi.mock("@/lib/reception/api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: { ...SUBSCRIPTION_PLUS, modules: ["medical_clinic"] },
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations: false,
    monthlySalesGoal: null,
  },
});

const hit = (over: Partial<clinicApi.PatientHit> = {}): clinicApi.PatientHit => ({
  customerId: "c1",
  name: "Rosa Luna Ríos",
  age: 36,
  birthDate: "1990-09-02",
  turnNumber: null,
  turnId: null,
  lastRecord: {
    id: "r0",
    folio: "HCL-000009",
    consultationDate: "2026-08-01",
    status: "closed",
    lockReason: "closed" as const,
  },
  ...over,
});

const expediente = (): clinicApi.MedicalRecord => ({
  id: "r1",
  folio: "HCL-000010",
  status: "open",
  editable: true,
  lockReason: null,
  consultationDate: "2026-09-03",
  closedAt: null,
  turnNumber: null,
  patient: {
    customerId: "c1",
    name: "Rosa Luna Ríos",
    birthDate: "1990-09-02",
    sex: null,
    age: 36,
  },
  doctor: { id: "u1", name: "Ana Pérez" },
  sections: [],
  orders: [],
  createdAt: "2026-09-03T18:00:00.000Z",
});

async function renderRuta(path: string, permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
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
  mocked.searchPatients.mockResolvedValue([hit()]);
  mocked.createRecord.mockResolvedValue(expediente());
  mocked.getRecord.mockResolvedValue(expediente());
  mocked.createPatient.mockResolvedValue({
    id: "c9",
    firstName: "Luis",
    lastNamePaternal: "Gómez",
    lastNameMaternal: null,
    birthDate: null,
    age: null,
    phone: null,
    email: null,
    notes: null,
    isActive: true,
    createdAt: "2026-09-03T18:00:00.000Z",
    updatedAt: "2026-09-03T18:00:00.000Z",
  });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

const ATTEND = ["medical_clinic:read", "medical_clinic:attend"];

describe("Atender paciente (F9-CLINIC-WEB-07)", () => {
  it("no consulta al montar; por nombre lista los aciertos con edad y última consulta", async () => {
    await renderRuta("/medical-clinic/attend", ATTEND);
    await screen.findByRole("heading", { name: "Atender paciente" });
    expect(mocked.searchPatients).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre del paciente"), "rosa");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() =>
      expect(mocked.searchPatients).toHaveBeenCalledWith({ mode: "name", q: "rosa" }),
    );
    const fila = await screen.findByTestId("patient-c1");
    expect(fila).toHaveTextContent("Rosa Luna Ríos");
    expect(fila).toHaveTextContent("36 años");
    expect(fila).toHaveTextContent("Última consulta HCL-000009");
  });

  it("cambiar a turno vacía el campo, solo admite dígitos y con un acierto NO navega solo", async () => {
    mocked.searchPatients.mockResolvedValue([hit({ turnNumber: 12 })]);
    const router = await renderRuta("/medical-clinic/attend", ATTEND);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre del paciente"), "rosa");
    await user.click(screen.getByRole("radio", { name: "Por turno" }));
    const campo = screen.getByLabelText("Número de turno");
    expect(campo).toHaveValue(null);
    await user.type(campo, "a12b");
    expect(campo).toHaveValue(12);
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() =>
      expect(mocked.searchPatients).toHaveBeenCalledWith({ mode: "turn", q: "12" }),
    );
    const fila = await screen.findByTestId("patient-c1");
    expect(fila).toHaveTextContent("Turno 12");
    expect(mocked.createRecord).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/medical-clinic/attend");
  });

  it("«Iniciar consulta» crea el expediente y navega a él", async () => {
    mocked.searchPatients.mockResolvedValue([hit({ turnNumber: 12 })]);
    const router = await renderRuta("/medical-clinic/attend", ATTEND);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Por turno" }));
    await user.type(screen.getByLabelText("Número de turno"), "12");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    const fila = await screen.findByTestId("patient-c1");
    await user.click(within(fila).getByRole("button", { name: "Iniciar consulta" }));
    await waitFor(() => expect(mocked.createRecord).toHaveBeenCalledWith({ customerId: "c1" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });

  it("sin resultados sale el vacío con el link «Paciente nuevo»; sin :attend no hay botón", async () => {
    mocked.searchPatients.mockResolvedValue([]);
    await renderRuta("/medical-clinic/attend", ATTEND);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre del paciente"), "nadie");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("No encontramos a nadie con ese nombre.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Paciente nuevo" })[0]).toHaveAttribute(
      "href",
      "/medical-clinic/patients/new",
    );
  });

  it("sin :attend la pantalla no se abre", async () => {
    await renderRuta("/medical-clinic/attend", ["medical_clinic:read"]);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Atender paciente" })).not.toBeInTheDocument(),
    );
  });
});

describe("Paciente nuevo (F9-CLINIC-WEB-08)", () => {
  it("el formulario vive en una tarjeta; Guardar da de alta por el consultorio y abre el expediente", async () => {
    const router = await renderRuta("/medical-clinic/patients/new", ATTEND);
    const titulo = await screen.findByRole("heading", { name: "Paciente nuevo" });
    expect(titulo.closest('[data-slot="card"]')).not.toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombres"), "Luis");
    await user.type(screen.getByLabelText("Apellido paterno"), "Gómez");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createPatient).toHaveBeenCalledWith({
        firstName: "Luis",
        lastNamePaternal: "Gómez",
      }),
    );
    await waitFor(() => expect(mocked.createRecord).toHaveBeenCalledWith({ customerId: "c9" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });
});

/**
 * F9-CLINIC-WEB-23 — una consulta abierta HOY se continúa: la tarjeta lleva
 * directo al expediente y no se abre otro folio.
 */
describe("Atender paciente — continuar la consulta abierta", () => {
  it("con una consulta abierta de hoy ofrece continuar, sin llamar al alta", async () => {
    mocked.searchPatients.mockResolvedValue([
      hit({
        lastRecord: {
          id: "r7",
          folio: "HCL-000007",
          consultationDate: "2026-09-03",
          status: "open",
          lockReason: null,
        },
      }),
    ]);
    await renderRuta("/medical-clinic/attend", ["medical_clinic:read", "medical_clinic:attend"]);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre del paciente"), "rosa");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    const continuar = await screen.findByRole("link", { name: "Continuar consulta HCL-000007" });
    expect(continuar).toHaveAttribute("href", "/medical-clinic/records/r7");
    expect(screen.queryByRole("button", { name: "Iniciar consulta" })).not.toBeInTheDocument();
    expect(mocked.createRecord).not.toHaveBeenCalled();
  });

  it("con una consulta vencida vuelve a ofrecer iniciar", async () => {
    mocked.searchPatients.mockResolvedValue([
      hit({
        lastRecord: {
          id: "r7",
          folio: "HCL-000007",
          consultationDate: "2026-09-02",
          status: "open",
          lockReason: "expired",
        },
      }),
    ]);
    await renderRuta("/medical-clinic/attend", ["medical_clinic:read", "medical_clinic:attend"]);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre del paciente"), "rosa");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByRole("button", { name: "Iniciar consulta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Continuar consulta/ })).not.toBeInTheDocument();
  });

  it("si el API dice que ya hay una abierta hoy, lleva a ESA consulta", async () => {
    mocked.searchPatients.mockResolvedValue([hit()]);
    mocked.createRecord.mockRejectedValue({
      statusCode: 409,
      code: "medical_clinic.record_open_today",
      message: "Este paciente ya tiene una consulta abierta hoy (HCL-000007).",
      recordId: "r7",
      folio: "HCL-000007",
    });
    const router = await renderRuta("/medical-clinic/attend", [
      "medical_clinic:read",
      "medical_clinic:attend",
    ]);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre del paciente"), "rosa");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r7"));
  });

  it("desde un turno, el expediente nace enlazado a ese turno", async () => {
    mocked.searchPatients.mockResolvedValue([hit({ turnNumber: 7, turnId: "t7" })]);
    await renderRuta("/medical-clinic/attend", ["medical_clinic:read", "medical_clinic:attend"]);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre del paciente"), "rosa");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    await waitFor(() =>
      expect(mocked.createRecord).toHaveBeenCalledWith({ customerId: "c1", turnId: "t7" }),
    );
  });
});

/**
 * Un turno que se generó sin cliente no es un callejón sin salida: se ve en
 * la búsqueda y «Iniciar consulta» lleva al alta del paciente, ligada a ESE
 * turno (Carlos, 2026-09-04).
 */
describe("Atender paciente — turno sin paciente", () => {
  const sinCliente = () =>
    hit({
      customerId: null,
      name: "",
      age: null,
      birthDate: null,
      turnNumber: 3,
      turnId: "t3",
      lastRecord: null,
    });

  it("se lista con su número y ofrece darlo de alta", async () => {
    mocked.searchPatients.mockResolvedValue([sinCliente()]);
    await renderRuta("/medical-clinic/attend", ATTEND);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Por turno" }));
    await user.type(screen.getByLabelText("Número de turno"), "3");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    const fila = await screen.findByTestId("patient-turn-t3");
    expect(fila).toHaveTextContent("Turno 3");
    expect(fila).toHaveTextContent("Sin paciente registrado");
    expect(within(fila).getByRole("button", { name: "Iniciar consulta" })).toBeInTheDocument();
  });

  it("«Iniciar consulta» lleva al alta del paciente con el turno a cuestas", async () => {
    mocked.searchPatients.mockResolvedValue([sinCliente()]);
    const router = await renderRuta("/medical-clinic/attend", ATTEND);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Por turno" }));
    await user.type(screen.getByLabelText("Número de turno"), "3");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(
      within(await screen.findByTestId("patient-turn-t3")).getByRole("button", {
        name: "Iniciar consulta",
      }),
    );

    // Ni se intenta abrir expediente: primero hay que saber a quién.
    expect(mocked.createRecord).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/medical-clinic/patients/new"),
    );
    expect(router.state.location.search).toMatchObject({ turnId: "t3" });
  });

  it("el paciente nuevo nace ligado al turno que lo trajo", async () => {
    const router = await renderRuta("/medical-clinic/patients/new?turnId=t3", ATTEND);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombres"), "Luis");
    await user.type(screen.getByLabelText("Apellido paterno"), "Gómez");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createRecord).toHaveBeenCalledWith({ customerId: "c9", turnId: "t3" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });
});
