import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { descargarBlob, nombreDeDescarga } from "@/lib/download";
import { downloadItemsReport, getItemsReport } from "./api";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/lib/download", () => ({
  descargarBlob: vi.fn(),
  nombreDeDescarga: vi.fn((_headers: unknown, respaldo: string) => respaldo),
}));

/**
 * F10-RPT-03 — el cliente del reporte por artículo: la pantalla y el archivo
 * viajan con los MISMOS filtros. Si el Excel los ignorara, bajaría todo lo
 * vendido mientras la pantalla muestra una sucursal.
 */
describe("el reporte por artículo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pide la vista con sus filtros, y desde el backoffice al negocio mirado", async () => {
    const pagina = { rows: [], totals: null, total: 0, page: 1, pageSize: 20 };
    vi.mocked(api.get).mockResolvedValue({ data: pagina });
    const query = {
      view: "below-cost" as const,
      type: "service" as const,
      warehouseId: "w-1",
      from: "2026-11-01",
      to: "2026-11-25",
      page: 2,
    };

    expect(await getItemsReport(query)).toEqual(pagina);
    expect(api.get).toHaveBeenCalledWith("/reports/items", { params: query });

    await getItemsReport(query, "/admin/tenants/t-1/reports");
    expect(api.get).toHaveBeenLastCalledWith("/admin/tenants/t-1/reports/items", {
      params: query,
    });
  });

  it("el archivo lleva los mismos filtros y el formato, con el nombre de su vista", async () => {
    const xlsx = new Blob(["PK"]);
    vi.mocked(api.get).mockResolvedValue({ data: xlsx, headers: {} });

    await downloadItemsReport({ view: "top-profit", type: "product", from: "2026-11-01" });

    expect(api.get).toHaveBeenCalledWith("/reports/items/export", {
      params: { view: "top-profit", type: "product", from: "2026-11-01", format: "xlsx" },
      responseType: "blob",
    });
    expect(nombreDeDescarga).toHaveBeenCalledWith({}, "mayor-utilidad.xlsx");
    expect(descargarBlob).toHaveBeenCalledWith(xlsx, "mayor-utilidad.xlsx");

    await downloadItemsReport({ view: "top-sold" }, "csv");
    expect(descargarBlob).toHaveBeenLastCalledWith(xlsx, "mas-vendidos.csv");
  });
});
