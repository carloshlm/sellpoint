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
 * F9-CLINIC-WEB-04/05 — los dos catálogos de estudios sobre la misma
 * pantalla: lista, búsqueda, alta en tarjeta con costo y precio de venta,
 * borrado con confirmación, y SIN un solo rastro de almacenes.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  listStudies: vi.fn(),
  createStudy: vi.fn(),
  updateStudy: vi.fn(),
  removeStudy: vi.fn(),
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

const estudio = (over: Partial<clinicApi.Study> = {}): clinicApi.Study => ({
  id: "s1",
  code: "BH",
  name: "Biometría hemática",
  description: null,
  cost: "40",
  price: "180",
  isActive: true,
  createdAt: "2026-09-03T18:00:00.000Z",
  updatedAt: "2026-09-03T18:00:00.000Z",
  ...over,
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
  mocked.listStudies.mockResolvedValue({
    rows: [estudio(), estudio({ id: "s2", code: "GLU", name: "Glucosa", price: "95", cost: null })],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  mocked.createStudy.mockResolvedValue(estudio({ id: "s3", code: "RX" }));
  mocked.removeStudy.mockResolvedValue(undefined);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe.each([
  ["lab", "/medical-clinic/lab-studies", "Estudios de Laboratorio"],
  ["diagnostic", "/medical-clinic/diagnostic-studies", "Estudios Diagnósticos"],
] as const)("catálogo %s (F9-CLINIC-WEB-04/05)", (kind, path, titulo) => {
  it("pinta las filas con costo y precio y consulta SU endpoint; sin almacenes", async () => {
    await renderRuta(path, ["medical_clinic:read", "medical_clinic:manage"]);
    expect(await screen.findByRole("heading", { name: titulo })).toBeInTheDocument();
    await waitFor(() => expect(mocked.listStudies).toHaveBeenCalledWith(kind, expect.anything()));
    const fila = screen.getByTestId("study-s1");
    expect(fila).toHaveTextContent("BH");
    expect(fila).toHaveTextContent("Biometría hemática");
    expect(fila).toHaveTextContent("40");
    expect(fila).toHaveTextContent("180");
    expect(document.querySelector('[data-testid^="service-warehouse"]')).toBeNull();
  });

  it("filtra por texto desde el servidor", async () => {
    await renderRuta(path, ["medical_clinic:read"]);
    await screen.findByTestId("study-s1");
    await userEvent.type(screen.getByLabelText("Buscar estudio"), "glu");
    await waitFor(() =>
      expect(mocked.listStudies).toHaveBeenLastCalledWith(
        kind,
        expect.objectContaining({ query: "glu", page: 1 }),
      ),
    );
  });

  it("«Agregar» abre el formulario en una tarjeta y Guardar manda costo y precio", async () => {
    await renderRuta(path, ["medical_clinic:read", "medical_clinic:manage"]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar" }));
    const titulo = screen.getByText("Nuevo estudio");
    expect(titulo.closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByLabelText("Código").closest('[data-slot="card"]')).toBe(
      titulo.closest('[data-slot="card"]'),
    );

    await user.type(screen.getByLabelText("Código"), "RX");
    await user.type(screen.getByLabelText("Nombre"), "Rayos X de tórax");
    await user.type(screen.getByLabelText("Costo"), "120");
    await user.type(screen.getByLabelText("Precio de venta"), "350");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocked.createStudy).toHaveBeenCalledWith(kind, {
        code: "RX",
        name: "Rayos X de tórax",
        cost: 120,
        price: 350,
      }),
    );
  });

  it("borrar pide confirmación y solo entonces llama al API", async () => {
    await renderRuta(path, ["medical_clinic:read", "medical_clinic:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("study-s1");
    await user.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(mocked.removeStudy).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog", { name: /Eliminar «Biometría hemática»/ });
    await user.click(within(dialogo).getByRole("button", { name: "Eliminar estudio" }));
    await waitFor(() => expect(mocked.removeStudy).toHaveBeenCalledWith(kind, "s1"));
  });

  it("sin :manage no hay «Agregar» ni acciones", async () => {
    await renderRuta(path, ["medical_clinic:read"]);
    await screen.findByTestId("study-s1");
    expect(screen.queryByRole("button", { name: "Agregar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });
});

/**
 * Importar el catálogo desde Excel, con el MISMO diálogo que Servicios
 * (Carlos, 2026-09-04): plantilla, archivo y reporte.
 */
describe.each([
  ["lab", "/medical-clinic/lab-studies", "Importar estudios de laboratorio"],
  ["diagnostic", "/medical-clinic/diagnostic-studies", "Importar estudios diagnósticos"],
])("importar %s", (kind, ruta, titulo) => {
  it("con :manage ofrece importar y abre el diálogo de la casa", async () => {
    await renderRuta(ruta, ["medical_clinic:read", "medical_clinic:manage"]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: titulo }));
    // El MISMO diálogo genérico que servicios: plantilla, archivo y reporte.
    const dialogo = await screen.findByTestId(`${kind}-study-import-dialog`);
    expect(dialogo).toHaveTextContent(titulo);
    expect(within(dialogo).getByRole("button", { name: "Plantilla Excel" })).toBeInTheDocument();
  });

  it("sin :manage no se ofrece", async () => {
    await renderRuta(ruta, ["medical_clinic:read"]);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: titulo })).not.toBeInTheDocument();
  });
});
