import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SuccessNotice } from "@/components/ui/success-notice";
import type { ApiError } from "@/lib/api";
import { readFileAsBase64 } from "@/lib/import/read-file";
import type { ImportReport, ImportRunInput } from "@/lib/import/types";
import { cn } from "@/lib/utils";

interface ImportDialogProps {
  /** Prefijo de los `data-testid`: `{prefix}-dialog`, `-report`, `-done`. */
  testIdPrefix: string;
  /**
   * Prefijo de las claves i18n. Debajo tienen que existir: title, step1,
   * downloadXlsx, step2, chooseFile, noFile, report, rowError,
   * rowErrorWithCode, skipErrors, confirm, done.
   */
  i18nPrefix: string;
  downloadTemplate: () => Promise<void>;
  run: (input: ImportRunInput) => Promise<ImportReport>;
  /** Cómo se lee el archivo; por defecto, a base64 (lo que todo importador espera). */
  readFile?: (file: File) => Promise<string>;
  /** Las queries que la importación deja viejas: el listado, sobre todo. */
  invalidate: readonly (readonly unknown[])[];
  onClose: () => void;
}

/**
 * El diálogo de importación de la casa (2026-09-01): el mismo flujo de dos
 * pasos para todo catálogo — bajar la plantilla, subir el Excel, ver el
 * reporte del dry-run y recién ahí aplicar. El match es por CÓDIGO y la
 * plantilla solo existe en Excel.
 *
 * Nació como copia de `ServiceImportDialog` (que a su vez copiaba al de
 * productos) cuando almacenes y subcatálogos pidieron el suyo: cuatro copias
 * del mismo diálogo son cuatro lugares donde un cambio de UX se hace tres
 * veces y se olvida una. Lo que cambia entre catálogos —textos, endpoints y
 * qué listado refrescar— entra por props.
 */
function ImportDialog({
  testIdPrefix,
  i18nPrefix,
  downloadTemplate,
  run,
  readFile = readFileAsBase64,
  invalidate,
  onClose,
}: ImportDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportReport | null>(null);
  const k = (key: string) => `${i18nPrefix}.${key}`;

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    const parsed = await readFile(file);
    setContent(parsed);
    setFileName(file.name);
    setBusy(true);
    try {
      setReport(await run({ content: parsed, dryRun: true }));
    } catch (apiError) {
      setError((apiError as ApiError).message);
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!content) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await run({ content, skipErrors });
      setDone(result);
      for (const queryKey of invalidate) {
        void queryClient.invalidateQueries({ queryKey: [...queryKey] });
      }
    } catch (apiError) {
      setError((apiError as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const fileInputId = `${testIdPrefix}-file`;

  return (
    <Card data-testid={`${testIdPrefix}-dialog`}>
      <CardHeader>
        <CardTitle>{t(k("title"))}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm">{t(k("step1"))}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void downloadTemplate()}
          >
            {t(k("downloadXlsx"))}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm">{t(k("step2"))}</p>
          {/* El control nativo se esconde y la etiqueta hace de botón: `<input
              type="file">` no se puede estilar. Sigue siendo el input REAL. */}
          <div className="flex items-center gap-3">
            <input
              id={fileInputId}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="peer sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleFile(file);
                }
              }}
            />
            <Label
              htmlFor={fileInputId}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
              )}
            >
              {t(k("chooseFile"))}
            </Label>
            <span className="text-muted-foreground text-xs">{fileName || t(k("noFile"))}</span>
          </div>
        </div>

        {busy && <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>}

        {report && !done && (
          <div
            className="flex flex-col gap-2 rounded-md border p-3 text-sm"
            data-testid={`${testIdPrefix}-report`}
          >
            <p>
              {t(k("report"), {
                valid: report.valid,
                created: report.created,
                updated: report.updated,
                failed: report.failed,
              })}
            </p>
            {report.errors.length > 0 && (
              <ul className="flex flex-col gap-1 text-destructive text-xs">
                {report.errors.slice(0, 10).map((rowError) => (
                  <li key={`${rowError.row}-${rowError.field ?? ""}`}>
                    {/* Con el código al lado, la fila se encuentra en el
                        Excel con un Ctrl+F (Carlos, 2026-09-01). */}
                    {t(rowError.itemCode ? k("rowErrorWithCode") : k("rowError"), {
                      row: rowError.row,
                      code: rowError.itemCode,
                      message: rowError.translated ?? rowError.message,
                    })}
                  </li>
                ))}
              </ul>
            )}
            {report.failed > 0 && (
              <label htmlFor={`${testIdPrefix}-skip`} className="flex items-center gap-2 text-xs">
                <Checkbox
                  id={`${testIdPrefix}-skip`}
                  checked={skipErrors}
                  onCheckedChange={(value) => setSkipErrors(value === true)}
                />
                {t(k("skipErrors"))}
              </label>
            )}
            <Button
              size="sm"
              className="w-fit"
              disabled={busy || report.valid === 0 || (report.failed > 0 && !skipErrors)}
              onClick={() => void confirmImport()}
            >
              {t(k("confirm"))}
            </Button>
          </div>
        )}

        {done && (
          <SuccessNotice testId={`${testIdPrefix}-done`}>
            <p className="font-medium">{t(k("done"), { count: done.created + done.updated })}</p>
          </SuccessNotice>
        )}

        <Button variant="outline" size="sm" className="w-fit" onClick={onClose}>
          {t("common.form.cancel")}
        </Button>
      </CardContent>
    </Card>
  );
}

export { ImportDialog };
