import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import { downloadImportTemplate, type ImportReport, runImport } from "@/lib/products/import-api";

/**
 * F2-IMPORT-04. Flujo de dos pasos obligatorio: se sube el archivo, se ve el
 * reporte y recién ahí se importa. Que el usuario sepa qué va a pasar ANTES de
 * que pase es la diferencia entre "importé 245" y "importé 245 y no sé cuáles
 * quedaron mal".
 */
function ProductImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportReport | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    const text = await file.text();
    setContent(text);
    setFileName(file.name);

    setBusy(true);
    try {
      setReport(await runImport({ content: text, dryRun: true }));
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
      const result = await runImport({ content, skipErrors });
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
          <div>
            <Button variant="outline" size="sm" onClick={() => void downloadImportTemplate()}>
              {t("products.import.downloadTemplate")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="import-file">{t("products.import.step2")}</Label>
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            className="text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
            }}
          />
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
        </div>

        {busy && <p role="status">{t("common.form.loading")}</p>}

        {report && !done && (
          <div className="flex flex-col gap-3" data-testid="import-report">
            <p className="text-sm">
              {t("products.import.valid", { count: report.valid })}
              {report.failed > 0 && ` · ${t("products.import.failed", { count: report.failed })}`}
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
