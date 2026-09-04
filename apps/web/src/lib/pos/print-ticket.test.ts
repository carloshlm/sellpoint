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
 * Carlos (2026-09-04): el papel sale SIEMPRE al vuelo, venta o cotización.
 * La cotización se abría en pestaña porque se pensó como documento que se
 * mira y se manda (2026-09-02); en el mostrador es lo mismo que un ticket —
 * el cliente está enfrente esperándolo, y una pestaña obliga a un clic más.
 * `abrirPdfParaImprimir` queda solo como respaldo dentro de `imprimirPdf`
 * cuando el navegador no deja imprimir el iframe.
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

  it("la cotización también sale al vuelo: cuadro de impresión, no pestaña", async () => {
    await printTicket("quote", "q-1", "COT-000001", "80mm");
    expect(api.get).toHaveBeenCalledWith("/pos/quotes/q-1/ticket", {
      responseType: "blob",
      params: { width: "80mm" },
    });
    expect(download.imprimirPdf).toHaveBeenCalledWith(blob, "COT-000001.pdf");
    expect(download.abrirPdfParaImprimir).not.toHaveBeenCalled();
  });
});
