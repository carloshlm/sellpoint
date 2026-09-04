import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { MedicalOrder, MedicationItem, Study } from "@/lib/medical-clinic/api";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { clinicUser, expediente } from "@/test/medical-clinic-fixture";

/**
 * F9-CLINIC-WEB-17/18/19/22 — las órdenes: estudios por checkbox, receta
 * desde el stock del médico, aviso con o sin cobro, impresión en carta y el
 * listado con su estado de cobro.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  getRecord: vi.fn(),
  closeRecord: vi.fn(),
  saveSection: vi.fn(),
  listStudies: vi.fn(),
  createOrder: vi.fn(),
  listOrders: vi.fn(),
  cancelOrder: vi.fn(),
  printMedicalOrder: vi.fn(),
  searchStock: vi.fn(),
  getSettings: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

const estudio = (id: string, code: string, name: string, price: string): Study => ({
  id,
  code,
  name,
  description: null,
  cost: null,
  price,
  isActive: true,
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
});

const medicamento = (id: string, name: string, available: string): MedicationItem => ({
  type: "product",
  matchedBy: "text",
  id,
  sku: `SKU-${id}`,
  name,
  baseUnit: "unit",
  isComposite: false,
  available,
  expired: "0",
  presentations: [
    {
      id: `${id}-caja`,
      name: "Caja",
      factor: "1",
      price: "45.00",
      barcode: null,
      isDefaultSale: true,
      allowFractionalInput: false,
    },
  ],
  matchedPresentationId: null,
});

const orden = (over: Partial<MedicalOrder>): MedicalOrder => ({
  id: "o1",
  recordId: "r1",
  kind: "lab_order",
  folio: "COT-000005",
  status: "issued",
  quoteId: "q1",
  quoteFolio: "COT-000005",
  saleId: null,
  chargeStatus: "pending",
  indications: null,
  diagnosis: null,
  total: "350.00",
  lines: [
    {
      id: "l1",
      lineNo: 1,
      productId: null,
      presentationId: null,
      labStudyId: "s1",
      diagnosticStudyId: null,
      description: "Biometría hemática",
      quantity: "1",
      unitPrice: "350.00",
      dosage: null,
    },
  ],
  createdAt: "2026-09-03T18:30:00.000Z",
  canceledAt: null,
  ...over,
});

async function renderRuta(
  path: string,
  permissions = ["medical_clinic:read", "medical_clinic:attend"],
) {
  useAuthStore.getState().setAuth("jwt-demo", clinicUser(permissions));
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
  mocked.getRecord.mockResolvedValue(expediente());
  mocked.listStudies.mockResolvedValue({
    rows: [
      estudio("s1", "BH", "Biometría hemática", "350.00"),
      estudio("s2", "QS", "Química sanguínea", "420.00"),
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  mocked.searchStock.mockResolvedValue({
    warehouseId: "w1",
    items: [
      medicamento("prod1", "Paracetamol 500 mg", "12"),
      medicamento("prod2", "Ibuprofeno 400 mg", "0"),
    ],
  });
  mocked.getSettings.mockResolvedValue({
    sellsMedications: true,
    sellsLabStudies: false,
    sellsDiagnosticStudies: false,
  });
  mocked.listOrders.mockResolvedValue([]);
  mocked.createOrder.mockResolvedValue(orden({}));
  mocked.printMedicalOrder.mockResolvedValue(undefined);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("orden de laboratorio (F9-CLINIC-WEB-17)", () => {
  it("un kind desconocido vuelve al tablero", async () => {
    const router = await renderRuta("/medical-clinic/records/r1/orders/no_existe");
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });

  it("marcar estudios los agrega como líneas, quitar una la borra y Emitir manda el payload", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/lab_order");
    const user = userEvent.setup();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Orden de laboratorio" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Buscar estudio de laboratorio"), "b");
    await user.click(await screen.findByRole("button", { name: /Biometría hemática/ }));
    await user.click(screen.getByRole("button", { name: /Química sanguínea/ }));
    const lineas = screen.getByTestId("order-lines");
    expect(within(lineas).getAllByRole("row")).toHaveLength(3); // encabezado + 2
    await user.click(within(lineas).getAllByRole("button", { name: "Quitar" })[1] as HTMLElement);
    expect(within(lineas).getAllByRole("row")).toHaveLength(2);
    await user.type(screen.getByLabelText("Indicaciones"), "Ayuno de 8 horas");
    await user.type(screen.getByLabelText("Diagnóstico relacionado"), "Faringitis");
    await user.click(screen.getByRole("button", { name: "Emitir orden" }));
    await waitFor(() =>
      expect(mocked.createOrder).toHaveBeenCalledWith("r1", {
        kind: "lab_order",
        lines: [{ labStudyId: "s1" }],
        indications: "Ayuno de 8 horas",
        diagnosis: "Faringitis",
      }),
    );
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("COT-000005");
    expect(aviso).toHaveTextContent(
      "Cotización lista para cobrar en caja con el folio COT-000005.",
    );
    await user.click(screen.getByRole("button", { name: "Imprimir orden" }));
    expect(mocked.printMedicalOrder).toHaveBeenCalledWith("o1", "COT-000005");
    expect(screen.getByRole("link", { name: "Volver a la historia clínica" })).toHaveAttribute(
      "href",
      "/medical-clinic/records/r1",
    );
  });

  it("no lista el catálogo sin buscar: se escribe y aparecen los aciertos", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/lab_order");
    await screen.findByRole("heading", { level: 1, name: "Orden de laboratorio" });
    // Igual que el buscador del punto de venta: en blanco no propone nada.
    expect(mocked.listStudies).not.toHaveBeenCalled();
    expect(screen.queryByText("Biometría hemática")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Buscar estudio de laboratorio"), "b");
    expect(await screen.findByRole("button", { name: /Biometría hemática/ })).toBeInTheDocument();
  });

  it("el buscador de estudios no habla de dinero: la orden es clínica", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/lab_order");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar estudio de laboratorio"), "b");
    const acierto = await screen.findByRole("button", { name: /Biometría hemática/ });
    expect(acierto).toHaveTextContent("BH");
    expect(acierto).not.toHaveTextContent("$");
  });

  it("al agregar, la lista de resultados se va: el buscador queda listo para el siguiente", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/lab_order");
    const user = userEvent.setup();
    const campo = await screen.findByLabelText("Buscar estudio de laboratorio");
    await user.type(campo, "b");
    await user.click(await screen.findByRole("button", { name: /Biometría hemática/ }));
    expect(campo).toHaveValue("");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Biometría hemática/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("order-lines")).toHaveTextContent("Biometría hemática");
  });

  it("una orden de estudios no habla de dinero en ningún lado", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/lab_order");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar estudio de laboratorio"), "b");
    await user.click(await screen.findByRole("button", { name: /Biometría hemática/ }));
    // Ni columna de precio, ni total: el médico ordena, la caja cobra.
    expect(screen.getByTestId("order-lines")).not.toHaveTextContent("$");
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  it("sin líneas no emite y avisa", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/diagnostic_order");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Emitir orden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Agrega al menos un estudio.");
    expect(mocked.createOrder).not.toHaveBeenCalled();
  });

  it("sin cotización dice que no se cobra en caja (F9-CLINIC-WEB-22)", async () => {
    mocked.createOrder.mockResolvedValue(
      orden({
        id: "o9",
        folio: "ORM-000001",
        quoteId: null,
        quoteFolio: null,
        chargeStatus: "not_for_sale",
      }),
    );
    await renderRuta("/medical-clinic/records/r1/orders/lab_order");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar estudio de laboratorio"), "b");
    await user.click(await screen.findByRole("button", { name: /Biometría hemática/ }));
    await user.click(screen.getByRole("button", { name: "Emitir orden" }));
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("Orden ORM-000001 registrada. No se cobra en caja.");
    expect(aviso).not.toHaveTextContent("Cotización lista");
    await user.click(screen.getByRole("button", { name: "Imprimir orden" }));
    expect(mocked.printMedicalOrder).toHaveBeenCalledWith("o9", "ORM-000001");
  });
});

describe("receta de medicamentos (F9-CLINIC-WEB-18)", () => {
  it("busca en el stock, lista la existencia, agrega con la presentación de venta y emite", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/prescription");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar medicamento"), "parac");
    await waitFor(() => expect(mocked.searchStock).toHaveBeenCalledWith("parac"));
    const paracetamol = await screen.findByTestId("medication-prod1");
    expect(paracetamol).toHaveTextContent("12 disponibles");
    expect(screen.getByTestId("medication-prod2")).toHaveTextContent("Sin existencia");
    await user.click(within(paracetamol).getByRole("button", { name: /Paracetamol/ }));
    const lineas = screen.getByTestId("order-lines");
    expect(lineas).toHaveTextContent("Paracetamol 500 mg");
    expect(lineas).toHaveTextContent("Caja");
    const cantidad = within(lineas).getByLabelText("Cantidad");
    fireEvent.change(cantidad, { target: { value: "2.5" } });
    expect(cantidad).toHaveValue(2);
    await user.type(within(lineas).getByLabelText("Indicación"), "1 cada 8 h");
    // Un producto en cero también se puede recetar.
    await user.click(
      within(screen.getByTestId("medication-prod2")).getByRole("button", { name: /Ibuprofeno/ }),
    );
    expect(within(lineas).getAllByRole("row")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Emitir orden" }));
    await waitFor(() =>
      expect(mocked.createOrder).toHaveBeenCalledWith("r1", {
        kind: "prescription",
        lines: [
          { productId: "prod1", presentationId: "prod1-caja", quantity: 2, dosage: "1 cada 8 h" },
          { productId: "prod2", presentationId: "prod2-caja", quantity: 1 },
        ],
      }),
    );
  });

  it("un 422 del API se muestra con su motivo, no con el genérico", async () => {
    mocked.createOrder.mockRejectedValue({
      statusCode: 422,
      message: "«SIN-LOTE-1» no tiene existencia vendible en este almacén.",
      code: "pos.product_not_available",
    });
    await renderRuta("/medical-clinic/records/r1/orders/prescription");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar medicamento"), "parac");
    await user.click(
      within(await screen.findByTestId("medication-prod1")).getByRole("button", {
        name: /Paracetamol/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Emitir orden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "«SIN-LOTE-1» no tiene existencia vendible en este almacén.",
    );
    expect(screen.queryByText("No pudimos emitir la orden.")).not.toBeInTheDocument();
  });

  it("si el stock no responde, lo dice en vez de fingir que no hay resultados", async () => {
    mocked.searchStock.mockRejectedValue({
      statusCode: 404,
      message: "medical_clinic.no_default_warehouse",
    });
    await renderRuta("/medical-clinic/records/r1/orders/prescription");
    await userEvent.type(await screen.findByLabelText("Buscar medicamento"), "parac");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos buscar. Intenta de nuevo.",
    );
    expect(screen.queryByText("Sin resultados.")).not.toBeInTheDocument();
  });

  it("el buscador de medicamentos tampoco muestra precios", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/prescription");
    await userEvent.type(await screen.findByLabelText("Buscar medicamento"), "parac");
    const fila = await screen.findByTestId("medication-prod1");
    expect(fila).toHaveTextContent("SKU-prod1");
    expect(fila).not.toHaveTextContent("$");
  });

  it("la receta no habla de dinero en ningún lado", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/prescription");
    const user = userEvent.setup();
    const campo = await screen.findByLabelText("Buscar medicamento");
    await user.type(campo, "parac");
    await user.click(
      within(await screen.findByTestId("medication-prod1")).getByRole("button", {
        name: /Paracetamol/,
      }),
    );
    expect(campo).toHaveValue("");
    expect(screen.getByTestId("order-lines")).not.toHaveTextContent("$");
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  it("si el negocio no vende medicamentos, el buscador no muestra existencia (F9-CLINIC-WEB-22)", async () => {
    mocked.getSettings.mockResolvedValue({
      sellsMedications: false,
      sellsLabStudies: false,
      sellsDiagnosticStudies: false,
    });
    await renderRuta("/medical-clinic/records/r1/orders/prescription", [
      "medical_clinic:read",
      "medical_clinic:attend",
      "tenants:manage",
    ]);
    await userEvent.type(await screen.findByLabelText("Buscar medicamento"), "parac");
    const paracetamol = await screen.findByTestId("medication-prod1");
    await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled());
    expect(paracetamol).not.toHaveTextContent("disponibles");
    expect(screen.getByTestId("medication-prod2")).not.toHaveTextContent("Sin existencia");
  });
});

describe("órdenes emitidas (F9-CLINIC-WEB-19)", () => {
  it("pinta folio, tipo y estado de cobro; Cancelar confirma antes de llamar al API; Imprimir abre el documento", async () => {
    mocked.listOrders.mockResolvedValue([
      orden({ id: "o1", folio: "COT-000005", chargeStatus: "charged", saleId: "v1" }),
      orden({ id: "o2", folio: "COT-000006", kind: "prescription", chargeStatus: "pending" }),
      orden({
        id: "o3",
        folio: "ORM-000001",
        kind: "diagnostic_order",
        quoteId: null,
        quoteFolio: null,
        chargeStatus: "not_for_sale",
      }),
      orden({
        id: "o4",
        folio: "ORM-000002",
        status: "canceled",
        canceledAt: "2026-09-03T19:00:00.000Z",
        quoteId: null,
        quoteFolio: null,
        chargeStatus: "not_for_sale",
      }),
    ]);
    mocked.cancelOrder.mockResolvedValue(orden({ id: "o2", status: "canceled" }));
    await renderRuta("/medical-clinic/records/r1/orders");
    const user = userEvent.setup();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Órdenes emitidas" }),
    ).toBeInTheDocument();
    // Sin columna de Total: en el consultorio importa si se proporcionó.
    expect(screen.queryByRole("columnheader", { name: "Total" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Estado" })).toBeInTheDocument();
    const o1 = screen.getByTestId("order-o1");
    expect(o1).toHaveTextContent("COT-000005");
    expect(o1).toHaveTextContent("Laboratorio");
    expect(o1).toHaveTextContent("Proporcionado");
    expect(o1).not.toHaveTextContent("$770.00");
    expect(within(o1).queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(screen.getByTestId("order-o2")).toHaveTextContent("No proporcionado");
    expect(screen.getByTestId("order-o3")).toHaveTextContent("No proporcionado");
    expect(screen.getByTestId("order-o4")).toHaveTextContent("Cancelada");
    await user.click(
      within(screen.getByTestId("order-o2")).getByRole("button", { name: "Cancelar" }),
    );
    expect(mocked.cancelOrder).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog", { name: "Cancelar la orden COT-000006" });
    await user.click(within(dialogo).getByRole("button", { name: "Cancelar orden" }));
    await waitFor(() => expect(mocked.cancelOrder).toHaveBeenCalledWith("o2"));
    await user.click(
      within(screen.getByTestId("order-o3")).getByRole("button", { name: "Imprimir orden" }),
    );
    expect(mocked.printMedicalOrder).toHaveBeenCalledWith("o3", "ORM-000001");
  });

  it("sin órdenes sale el vacío", async () => {
    await renderRuta("/medical-clinic/records/r1/orders");
    expect(await screen.findByText("Todavía no hay órdenes en esta consulta.")).toBeInTheDocument();
  });

  it("la tarjeta «Órdenes Emitidas» del tablero cuenta y enlaza", async () => {
    mocked.getRecord.mockResolvedValue(
      expediente({
        orders: [
          {
            id: "o1",
            kind: "lab_order",
            folio: "COT-000005",
            status: "issued",
            quoteId: "q1",
            createdAt: "2026-09-03T18:30:00.000Z",
          },
          {
            id: "o2",
            kind: "prescription",
            folio: "COT-000006",
            status: "issued",
            quoteId: "q2",
            createdAt: "2026-09-03T18:31:00.000Z",
          },
          {
            id: "o3",
            kind: "diagnostic_order",
            folio: "ORM-000001",
            status: "issued",
            quoteId: null,
            createdAt: "2026-09-03T18:32:00.000Z",
          },
        ],
      }),
    );
    await renderRuta("/medical-clinic/records/r1");
    const tarjeta = await screen.findByTestId("record-card-orders_list");
    expect(tarjeta).toHaveAttribute("href", "/medical-clinic/records/r1/orders");
    expect(tarjeta).toHaveTextContent("3 órdenes");
    expect(screen.getByTestId("record-group-orders")).toHaveTextContent("3 órdenes");
  });
});

/**
 * Al quitar los precios de las órdenes (2026-09-04) el encabezado se quedó con
 * la columna «Precio» Y con la vacía de la acción: una columna de más que la
 * fila, así que el título caía sobre «Quitar» y sobraba un hueco a la derecha.
 * Contar columnas es lo que caza la desalineación; mirar solo el texto no la ve.
 */
describe("la tabla de líneas no titula la columna de la acción (2026-09-04)", () => {
  const columnasCuadran = () => {
    const lineas = screen.getByTestId("order-lines");
    const [encabezado, primera] = within(lineas).getAllByRole("row") as HTMLElement[];
    expect(encabezado).not.toHaveTextContent("Precio");
    expect(within(encabezado as HTMLElement).getAllByRole("columnheader")).toHaveLength(
      within(primera as HTMLElement).getAllByRole("cell").length,
    );
  };

  it.each([
    ["lab_order", "Buscar estudio de laboratorio"],
    ["diagnostic_order", "Buscar estudio diagnóstico"],
  ])("orden de estudios (%s)", async (kind, etiqueta) => {
    await renderRuta(`/medical-clinic/records/r1/orders/${kind}`);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(etiqueta), "b");
    await user.click(await screen.findByRole("button", { name: /Biometría hemática/ }));
    columnasCuadran();
  });

  it("receta de medicamentos", async () => {
    await renderRuta("/medical-clinic/records/r1/orders/prescription");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar medicamento"), "parac");
    const paracetamol = await screen.findByTestId("medication-prod1");
    await user.click(within(paracetamol).getByRole("button", { name: /Paracetamol/ }));
    columnasCuadran();
  });
});
