import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  downloadDocumentPdf,
  downloadDocumentSpreadsheet,
  printDocumentPdf,
} from "@/lib/inventory/api";

interface PrintDocumentButtonProps {
  documentId: string;
  folio: string;
}

/**
 * F3-DOC-09 — imprimir el papel de un movimiento, guardarlo como PDF o
 * bajarlo en Excel.
 *
 * Son BOTONES y no un `<a href>` a propósito: el endpoint exige el Bearer y un
 * link plano iría sin token, devolviendo 401 sin explicación.
 *
 * «Imprimir» abre el cuadro de impresión con el papel ya cargado, como la
 * orden de compra y la compra (Carlos, 2026-09-15): un movimiento recién
 * confirmado se imprime para archivarlo. «Guardar como PDF» baja el mismo
 * papel con el folio por nombre (Carlos, 2026-10-30), para mandarlo o
 * guardarlo sin pasar por la impresora. «Descargar Excel» baja las mismas
 * filas para sumarlas (Carlos, 2026-10-30).
 * Quien pueda LEER inventario puede imprimir, porque auditar es leer.
 */
export function PrintDocumentButton({ documentId, folio }: PrintDocumentButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // Qué archivo falló: el aviso nombra el que se pidió, no siempre el PDF.
  const [failed, setFailed] = useState<"pdf" | "excel" | null>(null);

  async function conElPapel(
    accion: (id: string, folio: string) => Promise<void>,
    archivo: "pdf" | "excel" = "pdf",
  ) {
    setBusy(true);
    setFailed(null);
    try {
      await accion(documentId, folio);
    } catch {
      // El navegador no avisa cuando esto falla: sin este mensaje, quien
      // esperaba el cuadro de impresión se queda mirando una pantalla quieta.
      setFailed(archivo);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void conElPapel(downloadDocumentSpreadsheet, "excel")}
          disabled={busy}
          className="rounded-md border border-input px-3 py-2 text-sm disabled:opacity-50"
        >
          {t("inventory.document.downloadExcel")}
        </button>
        <button
          type="button"
          onClick={() => void conElPapel(downloadDocumentPdf)}
          disabled={busy}
          className="rounded-md border border-input px-3 py-2 text-sm disabled:opacity-50"
        >
          {t("inventory.document.savePdf")}
        </button>
        <button
          type="button"
          onClick={() => void conElPapel(printDocumentPdf)}
          disabled={busy}
          className="rounded-md border border-input px-3 py-2 text-sm disabled:opacity-50"
        >
          {t("inventory.document.print")}
        </button>
      </div>
      {failed !== null && (
        <span className="text-destructive text-xs">
          {t(
            failed === "excel" ? "inventory.document.excelFailed" : "inventory.document.pdfFailed",
          )}
        </span>
      )}
    </div>
  );
}
