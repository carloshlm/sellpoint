import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import {
  downloadServiceImportTemplate,
  readServiceImportFile,
  runServiceImport,
  type ServiceImportReport,
} from "@/lib/services/import-api";
import { cn } from "@/lib/utils";

/**
 * Importar SERVICIOS (Carlos, 2026-09-01) — el mismo flujo de dos pasos del
 * importador de productos: subir, ver el reporte, y recién ahí aplicar. El
 * match es por CÓDIGO y la plantilla solo existe en Excel.
 */
function ServiceImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ServiceImportReport | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ServiceImportReport | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    const parsed = await readServiceImportFile(file);
    setContent(parsed);
    setFileName(file.name);
    setBusy(true);
    try {
      setReport(await runServiceImport({ content: parsed, dryRun: true }));
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
      const result = await runServiceImport({ content, skipErrors });
      setDone(result);
      void queryClient.invalidateQueries({ queryKey: ["services"] });
    } catch (apiError) {
      setError((apiError as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="service-import-dialog">
      <CardHeader>
        <CardTitle>{t("services.import.title")}</CardTitle>
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
          <p className="text-sm">{t("services.import.step1")}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void downloadServiceImportTemplate()}
          >
            {t("services.import.downloadXlsx")}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("services.import.step2")}</p>
          <div className="flex items-center gap-3">
            <input
              id="service-import-file"
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
              htmlFor="service-import-file"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
              )}
            >
              {t("services.import.chooseFile")}
            </Label>
            <span className="text-muted-foreground text-xs">
              {fileName || t("services.import.noFile")}
            </span>
          </div>
        </div>

        {busy && <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>}

        {report && !done && (
          <div
            className="flex flex-col gap-2 rounded-md border p-3 text-sm"
            data-testid="service-import-report"
          >
            <p>
              {t("services.import.report", {
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
                    {t("services.import.rowError", { row: rowError.row })}{" "}
                    {rowError.translated ?? rowError.message}
                  </li>
                ))}
              </ul>
            )}
            {report.failed > 0 && (
              <label htmlFor="service-import-skip" className="flex items-center gap-2 text-xs">
                <Checkbox
                  id="service-import-skip"
                  checked={skipErrors}
                  onCheckedChange={(value) => setSkipErrors(value === true)}
                />
                {t("services.import.skipErrors")}
              </label>
            )}
            <Button
              size="sm"
              className="w-fit"
              disabled={busy || report.valid === 0 || (report.failed > 0 && !skipErrors)}
              onClick={() => void confirmImport()}
            >
              {t("services.import.confirm")}
            </Button>
          </div>
        )}

        {done && (
          <p
            className="rounded-md bg-success-soft px-3 py-2 text-sm"
            data-testid="service-import-done"
          >
            {t("services.import.done", { count: done.created + done.updated })}
          </p>
        )}

        <Button variant="outline" size="sm" className="w-fit" onClick={onClose}>
          {t("common.form.cancel")}
        </Button>
      </CardContent>
    </Card>
  );
}

export { ServiceImportDialog };
