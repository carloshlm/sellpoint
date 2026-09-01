import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SuccessNotice } from "@/components/ui/success-notice";
import { downloadCountTemplate, importDocumentLines } from "@/lib/inventory/api";
import { DOCUMENTS_QUERY_KEY } from "@/lib/inventory/hooks";
import type { DocumentDetail } from "@/lib/inventory/types";

/**
 * F3-COUNT-04 — la cabecera del conteo: bajar la plantilla y subir lo contado.
 *
 * La plantilla se pide para el almacén DEL DOCUMENTO y no para uno elegido
 * aparte: el borrador ya nació contra un almacén, y ofrecer otro invitaría a
 * contar un estante y aplicarlo sobre el de al lado.
 */
export function CountPanel({ document: doc }: { document: DocumentDetail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // El resultado de la última subida: el éxito se DICE (cuadro verde con el
  // foco), no se deja adivinar por el resumen que cambia solo (Carlos,
  // 2026-09-01).
  const [done, setDone] = useState<{
    imported: number;
    withErrors: number;
    /** Ninguna fila trajo «contado»: casi siempre, un archivo subido sin guardar. */
    noCounted: boolean;
  } | null>(null);

  const subir = useMutation({
    mutationFn: async (file: File) => {
      const esXlsx = file.name.toLowerCase().endsWith(".xlsx");
      const buffer = await file.arrayBuffer();
      // El xlsx es binario: viaja en base64. El csv es texto y va tal cual.
      const contenido = esXlsx
        ? btoa(String.fromCharCode(...new Uint8Array(buffer)))
        : new TextDecoder().decode(buffer);
      return importDocumentLines(doc.id, {
        file: contenido,
        format: esXlsx ? "xlsx" : "csv",
        // `replace` y no `append`: subir el conteo dos veces significa
        // corregirlo, no contarlo dos veces.
        mode: "replace",
      });
    },
    onSuccess: (resultado: {
      imported: number;
      withErrors: number;
      rows?: { counted: number | null }[];
    }) => {
      // Carlos (2026-09-01): subió el conteo y vio «0 coinciden, 19 omitidos»
      // sin explicación. Si NINGUNA fila trae «contado», se dice: lo más
      // probable es que el archivo se subió sin guardar los cambios de Excel.
      const noCounted =
        resultado.imported > 0 &&
        (resultado.rows ?? []).every((r) => r.counted === null || r.counted === undefined);
      setDone({ imported: resultado.imported, withErrors: resultado.withErrors, noCounted });
      void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, doc.id] });
    },
    onError: () => setError(t("inventory.count.importFailed")),
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-input p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void downloadCountTemplate(doc.warehouse.id, "xlsx")}
          className="rounded-md border border-input px-3 py-2 text-sm"
        >
          {t("inventory.count.templateXlsx")}
        </button>

        {/* Input `sr-only` detrás de su label: un `<input type="file">` crudo no
            se puede estilar y cada navegador lo dibuja distinto. Mismo patrón
            que la importación de productos (F2-IMPORT-05). */}
        <label
          htmlFor="count-upload"
          className="cursor-pointer rounded-md bg-primary px-3 py-2 text-primary-foreground text-sm"
        >
          {t("inventory.count.upload")}
        </label>
        <input
          id="count-upload"
          type="file"
          accept=".xlsx"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              setError(null);
              setDone(null);
              subir.mutate(file);
            }
          }}
        />
      </div>

      <p className="text-muted-foreground text-xs">{t("inventory.count.templateHint")}</p>
      <p className="text-muted-foreground text-xs">{t("inventory.count.uploadHint")}</p>
      {/* La pregunta más frecuente de un inventario: "¿y si alguien vende
          mientras cuento?". Se contesta antes de que la hagan. */}
      <p className="text-muted-foreground text-xs">{t("inventory.count.freshHint")}</p>

      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {done !== null && (
        <SuccessNotice testId="count-import-done">
          <p className="font-medium">{t("inventory.count.importDone", { count: done.imported })}</p>
          {done.withErrors > 0 && (
            <p className="text-muted-foreground">
              {t("inventory.count.importDoneWithErrors", { count: done.withErrors })}
            </p>
          )}
        </SuccessNotice>
      )}

      {done !== null && done.noCounted && (
        <p
          role="alert"
          data-testid="count-import-no-counted"
          className="rounded-md bg-warning-soft px-3 py-2 text-sm"
        >
          {t("inventory.count.importNoCounted", { count: done.imported })}
        </p>
      )}
    </div>
  );
}

/**
 * F3-COUNT-05 — el resumen de la reconciliación.
 *
 * Sale de `countSummary`, que lo calcula el servidor. Contarlo acá sobre las
 * filas visibles daría otro número apenas haya filtro o paginación.
 */
export function CountSummary({ document: doc }: { document: DocumentDetail }) {
  const { t } = useTranslation();
  const resumen = doc.countSummary;

  if (resumen === undefined) {
    return null;
  }

  const celdas = [
    ["summaryCounted", resumen.counted],
    ["summaryMatches", resumen.matches],
    ["summaryDiscrepancies", resumen.discrepancies],
    ["summarySkipped", resumen.skipped],
    ["summaryNewLots", resumen.newLots],
  ] as const;

  return (
    <div data-testid="count-summary" className="flex flex-wrap gap-4 rounded-md bg-muted px-4 py-3">
      {celdas.map(([clave, valor]) => (
        <div key={clave} className="flex flex-col">
          <span className="font-semibold text-lg">{valor}</span>
          <span className="text-muted-foreground text-xs">{t(`inventory.count.${clave}`)}</span>
        </div>
      ))}
    </div>
  );
}
