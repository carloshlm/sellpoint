import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as warehousesApi from "@/lib/warehouses/api";
import { StepWarehouse } from "./step-warehouse";

/**
 * F2-ONBOARD-03. El paso 3 dejó de ser un placeholder: crea un almacén REAL
 * porque desde F2-DB-07 la tabla existe.
 */
vi.mock("@/lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
}));

const mockedApi = vi.mocked(warehousesApi);

function renderStep(onSubmit = vi.fn()) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <StepWarehouse isSubmitting={false} onSubmit={onSubmit} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return onSubmit;
}

describe("StepWarehouse (F2-ONBOARD-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listWarehouses.mockResolvedValue([]);
  });

  it("sin almacenes pide un nombre y NO deja continuar vacío", async () => {
    renderStep();

    expect(await screen.findByLabelText(/almacén/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continuar/i })).toBeDisabled();
  });

  it("crea el almacén y recién entonces avanza", async () => {
    const user = userEvent.setup();
    mockedApi.createWarehouse.mockResolvedValue({
      id: "w-1",
      name: "Central",
      address: null,
      isActive: true,
      deactivationBlockedBy: null,
    });
    const onSubmit = renderStep();

    await user.type(await screen.findByLabelText(/almacén/i), "Central");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    // React Query v5 suma un segundo argumento de contexto al mutationFn.
    await waitFor(() =>
      expect(mockedApi.createWarehouse).toHaveBeenCalledWith(
        { name: "Central" },
        expect.anything(),
      ),
    );
    // El avance ocurre en onSuccess: si el POST falla, el wizard no se mueve.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it("si el alta falla, muestra el error y NO avanza", async () => {
    const user = userEvent.setup();
    mockedApi.createWarehouse.mockRejectedValue({
      statusCode: 409,
      message: "Ya existe un almacén con ese nombre",
      error: "Conflict",
    });
    const onSubmit = renderStep();

    await user.type(await screen.findByLabelText(/almacén/i), "Central");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByTestId("step-warehouse-error")).toHaveTextContent(
      "Ya existe un almacén",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /**
   * F3-HOME-03: el tenant NACE con su almacén (`provision()` lo crea), así que
   * este paso pasó de CREAR a RENOMBRAR. El input llega precargado.
   */
  it("con el almacén ya creado, el input trae su nombre y continuar no crea otro", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([
      {
        id: "w-1",
        name: "Almacén Central",
        address: null,
        isActive: true,
        deactivationBlockedBy: null,
      },
    ]);
    const onSubmit = renderStep();

    const input = await screen.findByTestId("step-warehouse-name");
    await waitFor(() => expect(input).toHaveValue("Almacén Central"));

    await user.click(screen.getByRole("button", { name: /continuar/i }));

    // Ni crea otro ni manda un PATCH que no cambia nada.
    expect(mockedApi.createWarehouse).not.toHaveBeenCalled();
    expect(mockedApi.updateWarehouse).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalled();
  });

  it("cambiar el nombre manda el PATCH y recién entonces avanza", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([
      {
        id: "w-1",
        name: "Almacén Central",
        address: null,
        isActive: true,
        deactivationBlockedBy: null,
      },
    ]);
    mockedApi.updateWarehouse.mockResolvedValue({
      id: "w-1",
      name: "CEDIS",
      address: null,
      isActive: true,
      deactivationBlockedBy: null,
    });
    const onSubmit = renderStep();

    const input = await screen.findByTestId("step-warehouse-name");
    await waitFor(() => expect(input).toHaveValue("Almacén Central"));
    await user.clear(input);
    await user.type(input, "CEDIS");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    await waitFor(() =>
      expect(mockedApi.updateWarehouse).toHaveBeenCalledWith("w-1", { name: "CEDIS" }),
    );
    expect(onSubmit).toHaveBeenCalled();
  });
});
