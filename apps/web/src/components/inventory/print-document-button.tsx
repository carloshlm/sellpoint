import { useState } from "react";
import { useTranslation } from "react-i18next";
import { printDocumentPdf } from "@/lib/inventory/api";

interface PrintDocumentButtonProps {
  documentId: string;
  folio: string;
}

/**
 * F3-DOC-09 — imprimir el papel de un movimiento.
 *
 * Es un BOTÓN y no un `<a href>` a propósito: el endpoint exige el Bearer y un
 * link plano iría sin token, devolviendo 401 sin explicación.
 *
 * Abre el cuadro de impresión con el papel ya cargado, como la orden de compra
 * y la compra (Carlos, 2026-09-15): un movimiento recién confirmado se imprime
 * para archivarlo, y bajar el archivo obligaba a ir a buscarlo a Descargas.
 * Quien pueda LEER inventario puede imprimir, porque auditar es leer.
 */
export function PrintDocumentButton({ documentId, folio }: PrintDocumentButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function imprimir() {
    setBusy(true);
    setFailed(false);
    try {
      await printDocumentPdf(documentId, folio);
    } catch {
      // El navegador no avisa cuando esto falla: sin este mensaje, quien
      // esperaba el cuadro de impresión se queda mirando una pantalla quieta.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void imprimir()}
        disabled={busy}
        className="rounded-md border border-input px-3 py-2 text-sm disabled:opacity-50"
      >
        {t("inventory.document.print")}
      </button>
      {failed && (
        <span className="text-destructive text-xs">{t("inventory.document.pdfFailed")}</span>
      )}
    </div>
  );
}
