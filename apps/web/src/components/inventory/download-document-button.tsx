import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadDocumentPdf } from "@/lib/inventory/api";

interface DownloadDocumentButtonProps {
  documentId: string;
  folio: string;
}

/**
 * F3-DOC-09 — bajar el PDF de un documento.
 *
 * Es un BOTÓN y no un `<a href>` a propósito: el endpoint exige el Bearer y un
 * link plano iría sin token, devolviendo 401 sin explicación. La descarga va
 * por axios con `responseType: 'blob'`, igual que `downloadImportTemplate` de
 * productos.
 *
 * Se usa en la pantalla del documento y —más adelante— en el kardex: cualquiera
 * que pueda LEER inventario puede imprimir, porque auditar es leer.
 */
export function DownloadDocumentButton({ documentId, folio }: DownloadDocumentButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function descargar() {
    setBusy(true);
    setFailed(false);
    try {
      await downloadDocumentPdf(documentId, folio);
    } catch {
      // El navegador no muestra nada cuando una descarga falla: sin este aviso
      // el usuario cree que el archivo se bajó y no lo encuentra.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void descargar()}
        disabled={busy}
        className="rounded-md border border-input px-3 py-2 text-sm disabled:opacity-50"
      >
        {t("inventory.document.downloadPdf")}
      </button>
      {failed && (
        <span className="text-destructive text-xs">{t("inventory.document.pdfFailed")}</span>
      )}
    </div>
  );
}
