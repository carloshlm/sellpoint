import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "@/i18n";
import { ReportTable } from "./report-table";

/**
 * F5-HUB-03 — el componente común de reporte.
 *
 * ── Por qué server-side y no cliente ────────────────────────────────────
 *
 * Porque los datasets no caben. Ordenar en el cliente ordena LA PÁGINA, no el
 * reporte: quien pide «los diez productos con más stock» recibiría los diez
 * mayores de las primeras veinte filas y no tendría forma de notarlo. Por eso
 * `manualPagination` y `manualSorting`: cada cambio vuelve a preguntar al
 * servidor, que es el único que ve el conjunto completo.
 */
describe("ReportTable (F5-HUB-03)", () => {
  const COLUMNAS = [
    { key: "name", header: "Producto" },
    { key: "quantity", header: "Cantidad", sortable: true },
  ];

  const FILAS = [
    { id: "1", name: "Zapallo", quantity: "3" },
    { id: "2", name: "Ají", quantity: "40" },
  ];

  function renderTabla(props: Partial<Parameters<typeof ReportTable>[0]> = {}) {
    const onQueryChange = vi.fn();
    render(
      <I18nextProvider i18n={createI18n()}>
        <ReportTable
          columns={COLUMNAS}
          rows={FILAS}
          total={42}
          page={1}
          pageSize={2}
          isPending={false}
          onQueryChange={onQueryChange}
          {...props}
        />
      </I18nextProvider>,
    );
    return { onQueryChange };
  }

  it("pinta las columnas y las filas que le dan", () => {
    renderTabla();

    expect(screen.getByRole("columnheader", { name: /producto/i })).toBeInTheDocument();
    expect(screen.getByText("Zapallo")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  /**
   * ⚠ El corazón del componente: ordenar NO reordena lo que ya está en
   * pantalla, PREGUNTA de nuevo. Las filas llegan a propósito desordenadas
   * («Zapallo» antes que «Ají», 3 antes que 40) para que un orden aplicado en
   * el cliente se note al instante.
   */
  it("ordenar consulta al SERVIDOR y no reordena la página en el cliente", async () => {
    const { onQueryChange } = renderTabla();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /cantidad/i }));

    await waitFor(() =>
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "quantity", sortDir: "asc", page: 1 }),
      ),
    );

    // Las filas siguen en el orden en que llegaron: quien ordena es el server.
    const filas = screen.getAllByRole("row").slice(1);
    expect(within(filas[0] as HTMLElement).getByText("Zapallo")).toBeInTheDocument();
  });

  it("un segundo clic invierte la dirección", async () => {
    const { onQueryChange } = renderTabla({ sortBy: "quantity", sortDir: "asc" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /cantidad/i }));

    await waitFor(() =>
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "quantity", sortDir: "desc" }),
      ),
    );
  });

  it("una columna no ordenable no ofrece el botón", () => {
    renderTabla();

    expect(screen.queryByRole("button", { name: /producto/i })).not.toBeInTheDocument();
  });

  describe("el paginador", () => {
    it("pasar de página consulta al servidor", async () => {
      const { onQueryChange } = renderTabla();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      await waitFor(() =>
        expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })),
      );
    });

    it("en la primera página no se puede retroceder", () => {
      renderTabla();

      expect(screen.getByRole("button", { name: /anterior/i })).toBeDisabled();
    });

    it("en la última no se puede avanzar", () => {
      renderTabla({ page: 21, pageSize: 2, total: 42 });

      expect(screen.getByRole("button", { name: /siguiente/i })).toBeDisabled();
    });

    /**
     * Cambiar el ORDEN vuelve a la página 1. Quedarse en la 7 con un orden
     * nuevo muestra filas que no tienen nada que ver con lo que se pidió, y
     * parece un error del sistema.
     */
    it("cambiar el orden vuelve a la primera página", async () => {
      const { onQueryChange } = renderTabla({ page: 5 });
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /cantidad/i }));

      await waitFor(() =>
        expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })),
      );
    });

    it("con una sola página el paginador no estorba", () => {
      renderTabla({ total: 2, pageSize: 20 });

      expect(screen.queryByRole("button", { name: /siguiente/i })).not.toBeInTheDocument();
    });
  });

  describe("los estados que no son «hay datos»", () => {
    it("mientras carga lo dice", () => {
      renderTabla({ isPending: true, rows: [] });

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("sin resultados lo explica en vez de dejar una tabla vacía", () => {
      renderTabla({ rows: [], total: 0 });

      expect(screen.getByText(/no hay/i)).toBeInTheDocument();
    });

    it("un error del servidor se pinta y no se traga", () => {
      renderTabla({ error: "No pudimos consultar el reporte." });

      expect(screen.getByRole("alert")).toHaveTextContent("No pudimos consultar");
    });
  });

  it("el botón de exportar avisa a quien lo monta", async () => {
    const onExport = vi.fn();
    renderTabla({ onExport });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /exportar/i }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("sin `onExport` no se pinta el botón: no todo reporte se baja", () => {
    renderTabla();

    expect(screen.queryByRole("button", { name: /exportar/i })).not.toBeInTheDocument();
  });
});
