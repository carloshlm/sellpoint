import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import {
  downloadImportTemplate,
  type ImportFormat,
  type ImportReport,
  readImportFile,
  runImport,
} from "@/lib/products/import-api";
import { cn } from "@/lib/utils";

/**
 * F2-IMPORT-04. Flujo de dos pasos obligatorio: se sube el archivo, se ve el
 * reporte y recién ahí se importa. Que el usuario sepa qué va a pasar ANTES de
 * que pase es la diferencia entre "importé 245" y "importé 245 y no sé cuáles
 * quedaron mal".
 *
 * Desde que la plantilla trae los productos existentes, el reporte separa altas
 * de actualizaciones: "245 válidas" no dice nada si 200 de esas van a PISAR
 * productos que ya están cargados.
 */
function ProductImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportReport | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    const parsed = await readImportFile(file);
    setContent(parsed.content);
    setFormat(parsed.format);
    setFileName(file.name);

    setBusy(true);
    try {
      setReport(await runImport({ content: parsed.content, format: parsed.format, dryRun: true }));
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
      const result = await runImport({ content, format, skipErrors });
      setDone(result);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (apiError) {
      setError((apiError as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="import-dialog">
      <CardHeader>
        <CardTitle>{t("products.import.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p
            role="alert"
            data-testid="import-error"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("products.import.step1")}</p>
          <div className="flex gap-2">
            {/* Solo Excel (Carlos, 2026-09-01): dos formatos era una decisión
                que nadie necesitaba tomar, y el CSV rompía acentos en Excel
                según la configuración regional de cada máquina. */}
            <Button variant="outline" size="sm" onClick={() => void downloadImportTemplate("xlsx")}>
              {t("products.import.downloadXlsx")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("products.import.step2")}</p>
          {/*
            El control nativo se esconde y la etiqueta hace de botón: `<input
            type="file">` no se puede estilar y cada navegador dibuja el suyo.
            Sigue siendo el input real —accesible y enfocable por teclado, de ahí
            el `peer-focus-visible`—, no un botón que simula abrir el diálogo.
          */}
          <div className="flex items-center gap-3">
            <input
              id="import-file"
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
              htmlFor="import-file"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
              )}
            >
              {t("products.import.chooseFile")}
            </Label>
            <span className="text-xs text-muted-foreground" data-testid="import-file-name">
              {fileName || t("products.import.noFile")}
            </span>
          </div>
        </div>

        {busy && <p role="status">{t("common.form.loading")}</p>}

        {report && !done && (
          <div className="flex flex-col gap-3" data-testid="import-report">
            <p className="text-sm">
              {t("products.import.valid", { count: report.valid })}
              {report.failed > 0 && ` · ${t("products.import.failed", { count: report.failed })}`}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="import-breakdown">
              {t("products.import.breakdown", {
                created: report.created,
                updated: report.updated,
              })}
            </p>

            {report.errors.length > 0 && (
              <ul className="max-h-40 overflow-y-auto text-xs text-muted-foreground">
                {report.errors.map((rowError) => (
                  <li key={`${rowError.row}-${rowError.message}`}>
                    {t("products.import.rowError", {
                      row: rowError.row,
                      message: t(rowError.message),
                    })}
                  </li>
                ))}
              </ul>
            )}

            {report.failed > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="skip-errors"
                  checked={skipErrors}
                  onCheckedChange={(checked) => setSkipErrors(checked === true)}
                />
                <Label htmlFor="skip-errors">{t("products.import.skipErrors")}</Label>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                disabled={busy || report.valid === 0 || (report.failed > 0 && !skipErrors)}
                onClick={() => void confirmImport()}
              >
                {t("products.import.confirm", { count: report.valid })}
              </Button>
              <Button variant="outline" onClick={onClose}>
                {t("common.form.cancel")}
              </Button>
            </div>
          </div>
        )}

        {done && (
          <div className="flex flex-col gap-3" data-testid="import-done">
            <p className="text-sm">{t("products.import.done", { count: done.imported })}</p>
            <p className="text-sm text-muted-foreground">
              {t("products.import.doneBreakdown", {
                created: done.created,
                updated: done.updated,
              })}
            </p>
            <div>
              <Button onClick={onClose}>{t("products.import.close")}</Button>
            </div>
          </div>
        )}

        {!report && !done && (
          <div>
            <Button variant="outline" onClick={onClose}>
              {t("common.form.cancel")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { ProductImportDialog };
