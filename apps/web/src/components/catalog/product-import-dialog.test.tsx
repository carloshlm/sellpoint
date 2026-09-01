import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as importApi from "@/lib/products/import-api";
import { createQueryClient } from "@/lib/query-client";
import { ProductImportDialog } from "./product-import-dialog";

/**
 * F2-IMPORT-04, ampliado el 2026-08-16: `.xlsx` y plantilla con lo ya cargado.
 *
 * `readImportFile` NO se mockea: convertir el binario a base64 es justamente lo
 * que puede salir mal al sumar Excel, y mockearlo sería testear el mock.
 */
vi.mock("@/lib/products/import-api", async (importOriginal) => ({
  ...(await importOriginal<typeof importApi>()),
  runImport: vi.fn(),
  downloadImportTemplate: vi.fn(),
}));

const mockedApi = vi.mocked(importApi);

const emptyReport = {
  valid: 1,
  failed: 0,
  errors: [],
  created: 1,
  updated: 0,
  imported: 0,
};

function renderDialog() {
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <ProductImportDialog onClose={onClose} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return onClose;
}

describe("ProductImportDialog (F2-IMPORT-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.runImport.mockResolvedValue(emptyReport);
  });

  it("el control de archivo se opera por su etiqueta: el input nativo queda oculto", () => {
    renderDialog();

    const input = screen.getByLabelText("Elegir archivo");
    // Sigue siendo el input REAL —accesible y enfocable—, solo que invisible:
    // un botón que simule abrir el diálogo no puede abrirlo.
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveClass("sr-only");
    expect(input).toHaveAttribute("accept", expect.stringContaining(".xlsx"));
  });

  it("el selector de archivo solo acepta Excel (Carlos, 2026-09-01)", () => {
    renderDialog();

    // Dos formatos era una decisión que nadie necesitaba tomar: el CSV se fue
    // del flujo y el input ya ni lo ofrece.
    expect(screen.getByLabelText("Elegir archivo")).toHaveAttribute(
      "accept",
      ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(screen.queryByRole("button", { name: "Plantilla CSV" })).not.toBeInTheDocument();
  });

  it("un .xlsx viaja en base64 y declara su formato", async () => {
    const user = userEvent.setup();
    renderDialog();

    // Bytes binarios reales: si se leyera como texto, se corromperían.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    await user.upload(
      screen.getByLabelText("Elegir archivo"),
      new File([bytes], "productos.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    await waitFor(() => expect(mockedApi.runImport).toHaveBeenCalled());
    const payload = mockedApi.runImport.mock.calls[0]?.[0];
    expect(payload?.format).toBe("xlsx");
    expect(payload?.content).toBe(btoa(String.fromCharCode(...bytes)));
  });

  it("el reporte separa altas de actualizaciones antes de confirmar", async () => {
    const user = userEvent.setup();
    mockedApi.runImport.mockResolvedValue({ ...emptyReport, valid: 3, created: 1, updated: 2 });
    renderDialog();

    await user.upload(
      screen.getByLabelText("Elegir archivo"),
      new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "productos.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    // "3 válidas" no alcanza: 2 de esas PISAN productos ya cargados.
    const breakdown = await screen.findByTestId("import-breakdown");
    expect(breakdown).toHaveTextContent("1");
    expect(breakdown).toHaveTextContent("2");
  });

  const subirExcel = (user: ReturnType<typeof userEvent.setup>) =>
    user.upload(
      screen.getByLabelText("Elegir archivo"),
      new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "productos.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

  /**
   * Carlos (2026-09-01): «Fila 2: esa unidad no existe» manda a contar
   * renglones en el Excel. Con el código interno al lado, la fila se
   * encuentra con un Ctrl+F.
   */
  it("cada error de fila nombra el código interno del producto", async () => {
    const user = userEvent.setup();
    mockedApi.runImport.mockResolvedValue({
      ...emptyReport,
      valid: 0,
      failed: 2,
      // `message` llega YA traducido del API (el backend traduce; ver
      // import.service). La clave cruda viaja aparte en `code`.
      errors: [
        { row: 2, message: "Esa unidad de medida no existe.", itemCode: "CODINT001" },
        // Sin código (la fila vino sin sku): no se pinta un «undefined -».
        { row: 3, message: "Faltan el código o el nombre." },
      ],
    });
    renderDialog();

    await subirExcel(user);

    const reporte = await screen.findByTestId("import-report");
    expect(reporte).toHaveTextContent("Fila 2: CODINT001 - Esa unidad de medida no existe.");
    expect(reporte).toHaveTextContent("Fila 3: Faltan el código o el nombre.");
    expect(reporte).not.toHaveTextContent("undefined");
  });

  /**
   * El éxito tiene que VERSE y OÍRSE: cuadro verde, y el foco se va ahí para
   * que el lector de pantalla lo anuncie y el ojo lo encuentre sin buscar.
   */
  it("al terminar, el resultado va en un cuadro de éxito con el foco puesto", async () => {
    const user = userEvent.setup();
    mockedApi.runImport.mockResolvedValue({ ...emptyReport, valid: 10, updated: 10, created: 0 });
    renderDialog();
    await subirExcel(user);
    await screen.findByTestId("import-report");

    mockedApi.runImport.mockResolvedValue({
      ...emptyReport,
      imported: 10,
      updated: 10,
      created: 0,
    });
    await user.click(screen.getByRole("button", { name: "Importar 10" }));

    const listo = await screen.findByTestId("import-done");
    expect(listo).toHaveAttribute("role", "status");
    expect(listo).toHaveClass("bg-success-soft");
    expect(listo).toHaveTextContent("Se importaron 10 productos.");
    expect(listo).toHaveTextContent("0 nuevos · 10 actualizados");
    expect(listo).toHaveFocus();
  });

  it("la plantilla solo existe en Excel", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Plantilla Excel" }));
    expect(mockedApi.downloadImportTemplate).toHaveBeenCalledWith("xlsx");
  });
});
