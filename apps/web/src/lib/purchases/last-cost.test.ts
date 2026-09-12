import { api } from "@/lib/api";
import { getLastCost } from "./api";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
const mockedGet = vi.mocked(api.get);

/**
 * Carlos, en producción (2026-09-12): agregar un producto SIN historial con
 * el proveedor tumbaba la ficha — el API devolvía un cuerpo vacío, el web lo
 * leía como "" (que no es null) y pintaba `formatMoney(undefined)`. Solo un
 * objeto con `unitCost` es un costo; todo lo demás es «sin historial».
 */
describe("getLastCost — sin historial nunca revienta", () => {
  it.each([
    ["cuerpo vacío", ""],
    ["null suelto", null],
    ["objeto con lastCost null", { lastCost: null }],
    ["objeto sin unitCost", { lastCost: { folio: "COM-1" } }],
  ])("%s → null", async (_caso, data) => {
    mockedGet.mockResolvedValueOnce({ data });
    await expect(getLastCost({ supplierId: "s1", productId: "p1" })).resolves.toBeNull();
  });

  it("con historial devuelve el costo tal cual", async () => {
    const ultimo = {
      unitCost: "600",
      presentationId: "pres-1",
      presentationName: "Bolsa 10Kg",
      taxMode: "excluded" as const,
      folio: "COM-000008",
      purchaseDate: "2026-09-11",
    };
    mockedGet.mockResolvedValueOnce({ data: { lastCost: ultimo } });
    await expect(getLastCost({ supplierId: "s1", productId: "p1" })).resolves.toEqual(ultimo);
  });
});
