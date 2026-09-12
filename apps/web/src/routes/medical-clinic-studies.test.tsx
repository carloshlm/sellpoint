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
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

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
vi.mock("@/lib/tenant/tax-api", () => ({
  getTaxSettings: vi.fn().mockResolvedValue({
    mode: "included",
    country: "MX",
    region: null,
    needsRegion: false,
    hasSales: false,
    groups: [
      {
        id: "tg-vat",
        code: "VAT16",
        name: "IVA 16%",
        isDefault: true,
        isActive: true,
        sortOrder: 0,
        usageCount: 0,
        rates: [{ code: "VAT", name: "IVA 16%", rate: "16" }],
      },
      {
        id: "tg-ex",
        code: "EXEMPT",
        name: "Exento",
        isDefault: false,
        isActive: true,
        sortOrder: 1,
        usageCount: 0,
        rates: [],
      },
    ],
  }),
  updateTaxSettings: vi.fn(),
  deleteTaxGroup: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

const demoUser = (
  permissions: string[],
  costTaxMode: "included" | "excluded" = "excluded",
): AuthUser =>
  buildAuthUser({
    permissions,
    tenant: buildTenantBlock({ costTaxMode }),
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["medical_clinic"] },
  });

const estudio = (over: Partial<clinicApi.Study> = {}): clinicApi.Study => ({
  id: "s1",
  code: "BH",
  name: "Biometría hemática",
  description: null,
  cost: "40",
  price: "180",
  taxGroupId: null,
  isActive: true,
  createdAt: "2026-09-03T18:00:00.000Z",
  updatedAt: "2026-09-03T18:00:00.000Z",
  ...over,
});

async function renderRuta(
  path: string,
  permissions: string[],
  costTaxMode: "included" | "excluded" = "excluded",
) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions, costTaxMode));
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
    await user.type(screen.getByLabelText("Costo (sin impuesto)"), "120");
    await user.type(screen.getByLabelText("Precio de venta (con impuesto incluido)"), "350");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocked.createStudy).toHaveBeenCalledWith(kind, {
        code: "RX",
        name: "Rayos X de tórax",
        cost: 120,
        price: 350,
        // F4-TAX-15: sin tocar el selector, el default del negocio (null).
        taxGroupId: null,
      }),
    );
  });

  // Mismo criterio que servicios (Carlos, 2026-09-07): el campo ya es texto
  // con teclado decimal, así que lo que no es un importe se marca acá y no
  // en un 422 del API; y al salir del campo queda a dos decimales.
  it("la etiqueta del costo dice la base del negocio (F9-COSTMODE-10)", async () => {
    await renderRuta(path, ["medical_clinic:read", "medical_clinic:manage"], "included");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar" }));
    expect(screen.getByLabelText("Costo (con impuesto incluido)")).toBeInTheDocument();
    expect(screen.getByText(/con el impuesto adentro/)).toBeInTheDocument();
  });

  it("un costo con coma se marca y bloquea Guardar; al corregirlo queda a dos decimales", async () => {
    await renderRuta(path, ["medical_clinic:read", "medical_clinic:manage"]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar" }));
    await user.type(screen.getByLabelText("Código"), "RX");
    await user.type(screen.getByLabelText("Nombre"), "Rayos X de tórax");
    const costo = screen.getByLabelText("Costo (sin impuesto)");

    await user.type(costo, "1,500");
    expect(screen.getByText(/punto decimal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await user.clear(costo);
    await user.type(costo, "1500");
    await user.tab();
    expect(costo).toHaveValue("1500.00");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(mocked.createStudy).not.toHaveBeenCalled();
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

/** F4-TAX-15 — el selector «Impuesto» del estudio: elegir «Exento» manda su id. */
describe("el selector «Impuesto» del estudio (F4-TAX-15)", () => {
  it("elegir «Exento» manda taxGroupId con su id", async () => {
    await renderRuta("/medical-clinic/lab-studies", [
      "medical_clinic:read",
      "medical_clinic:manage",
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar" }));
    const select = await screen.findByLabelText("Impuesto");
    await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(3));
    await user.selectOptions(select, "tg-ex");
    await user.type(screen.getByLabelText("Código"), "BH");
    await user.type(screen.getByLabelText("Nombre"), "Biometría hemática");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createStudy).toHaveBeenCalledWith(
        "lab",
        expect.objectContaining({ code: "BH", taxGroupId: "tg-ex" }),
      ),
    );
  });
});
