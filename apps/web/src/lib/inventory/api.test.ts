import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { descargarBlob, imprimirPdf } from "@/lib/download";
import { downloadDocumentPdf, downloadDocumentSpreadsheet } from "./api";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/lib/download", () => ({
  descargarBlob: vi.fn(),
  imprimirPdf: vi.fn(),
  nombreDeDescarga: vi.fn(),
}));

/**
 * Carlos (2026-10-30): «Guardar como PDF» baja el MISMO papel que «Imprimir»,
 * con el folio por nombre: INV-000002.pdf.
 */
describe("downloadDocumentPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pide el PDF del movimiento y lo baja como <folio>.pdf", async () => {
    const pdf = new Blob(["%PDF"], { type: "application/pdf" });
    vi.mocked(api.get).mockResolvedValue({ data: pdf, headers: {} });

    await downloadDocumentPdf("doc-1", "INV-000002");

    expect(api.get).toHaveBeenCalledWith("/inventory/documents/doc-1/pdf", {
      responseType: "blob",
    });
    expect(descargarBlob).toHaveBeenCalledWith(pdf, "INV-000002.pdf");
    expect(imprimirPdf).not.toHaveBeenCalled();
  });

  it("el Excel se pide aparte y baja como <folio>.xlsx", async () => {
    const xlsx = new Blob(["PK"]);
    vi.mocked(api.get).mockResolvedValue({ data: xlsx, headers: {} });

    await downloadDocumentSpreadsheet("doc-1", "INV-000019");

    expect(api.get).toHaveBeenCalledWith("/inventory/documents/doc-1/xlsx", {
      responseType: "blob",
    });
    expect(descargarBlob).toHaveBeenCalledWith(xlsx, "INV-000019.xlsx");
  });
});
