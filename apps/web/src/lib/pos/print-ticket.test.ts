import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/lib/download", () => ({
  imprimirPdf: vi.fn(),
  abrirPdfParaImprimir: vi.fn(),
}));

const { api } = vi.mocked(await import("@/lib/api"));
const download = vi.mocked(await import("@/lib/download"));
const { printTicket } = await import("./api");

/**
 * Carlos (2026-09-02): el ticket de VENTA va directo al cuadro de impresión,
 * como el papel del turno. La cotización se sigue abriendo en pestaña: es un
 * documento que se mira y se manda, no un papel que sale de la térmica.
 */
describe("printTicket", () => {
  const blob = new Blob(["%PDF"]);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: blob });
  });

  it("el ticket de venta se imprime en el acto, con el ancho pedido", async () => {
    await printTicket("sale", "sale-1", "VTA-000001");
    expect(api.get).toHaveBeenCalledWith("/pos/sales/sale-1/ticket", {
      responseType: "blob",
      params: { width: "58mm" },
    });
    expect(download.imprimirPdf).toHaveBeenCalledWith(blob, "VTA-000001.pdf");
    expect(download.abrirPdfParaImprimir).not.toHaveBeenCalled();
  });

  it("la cotización se abre en pestaña, sin cuadro de impresión", async () => {
    await printTicket("quote", "q-1", "COT-000001", "80mm");
    expect(api.get).toHaveBeenCalledWith("/pos/quotes/q-1/ticket", {
      responseType: "blob",
      params: { width: "80mm" },
    });
    expect(download.abrirPdfParaImprimir).toHaveBeenCalledWith(blob, "COT-000001.pdf");
    expect(download.imprimirPdf).not.toHaveBeenCalled();
  });
});
