import type { Currency, MedicalOrderKind } from "@sellpoint/shared";
import { formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowAction } from "@/components/ui/row-action";
import { SuccessNotice } from "@/components/ui/success-notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import type { MedicalOrder } from "@/lib/medical-clinic/api";
import { printMedicalOrder } from "@/lib/medical-clinic/api";
import { useCreateOrder } from "@/lib/medical-clinic/hooks";
import {
  lineTotal,
  normalizeQuantity,
  type OrderFormLine,
  orderTotal,
  toPayload,
} from "@/lib/medical-clinic/order-lines";
import { useAuthStore } from "@/stores/auth.store";

interface OrderFormShellProps {
  recordId: string;
  kind: MedicalOrderKind;
  lines: OrderFormLine[];
  onLinesChange: (lines: OrderFormLine[]) => void;
  /** El buscador que agrega líneas (estudios o medicamentos). */
  children: React.ReactNode;
}

/**
 * F9-CLINIC-WEB-17/22 — lo común a las tres órdenes: las líneas, las
 * indicaciones, el diagnóstico, el total y la emisión. Al emitir, el aviso
 * depende de si nació cotización (se cobra en caja) o no (solo se imprime).
 */
export function OrderFormShell({
  recordId,
  kind,
  lines,
  onLinesChange,
  children,
}: OrderFormShellProps) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const emitir = useCreateOrder(recordId);
  const [indications, setIndications] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [sinLineas, setSinLineas] = useState(false);
  const [emitida, setEmitida] = useState<MedicalOrder | null>(null);
  const [errorImpresion, setErrorImpresion] = useState(false);
  const esReceta = kind === "prescription";

  const actualizar = (key: string, cambio: (line: OrderFormLine) => OrderFormLine) =>
    onLinesChange(lines.map((l) => (l.key === key ? cambio(l) : l)));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (lines.length === 0) {
      setSinLineas(true);
      return;
    }
    setSinLineas(false);
    const ind = indications.trim();
    const dx = diagnosis.trim();
    emitir.mutate(
      {
        kind,
        lines: lines.map(toPayload),
        ...(ind ? { indications: ind } : {}),
        ...(dx ? { diagnosis: dx } : {}),
      },
      { onSuccess: setEmitida },
    );
  };

  /**
   * El backend ya manda el motivo traducido en los 4xx (««SKU» no tiene
   * existencia vendible…»): se muestra tal cual. Red o 5xx caen al genérico.
   */
  const mensajeDeError = (error: ApiError) =>
    error.statusCode >= 400 && error.statusCode < 500 && error.message
      ? error.message
      : t("medicalClinic.orders.saveFailed");

  const imprimir = (orden: MedicalOrder) => {
    setErrorImpresion(false);
    printMedicalOrder(orden.id, orden.folio).catch(() => setErrorImpresion(true));
  };

  if (emitida) {
    return (
      <div className="flex flex-col gap-4">
        <SuccessNotice>
          <span className="flex flex-col gap-1">
            <span className="font-mono text-lg">{emitida.folio}</span>
            <span>
              {emitida.quoteId
                ? t("medicalClinic.orders.chargeNotice", { folio: emitida.folio })
                : t("medicalClinic.orders.noChargeNotice", { folio: emitida.folio })}
            </span>
          </span>
        </SuccessNotice>
        {errorImpresion ? (
          <p role="alert" className="text-destructive text-sm">
            {t("medicalClinic.orders.printFailed")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => imprimir(emitida)}>
            {t("medicalClinic.orders.print")}
          </Button>
          <Button asChild variant="outline">
            <Link to="/medical-clinic/records/$recordId" params={{ recordId }}>
              {t("medicalClinic.orders.backToRecord")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-6" aria-busy={emitir.isPending}>
      {emitir.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {mensajeDeError(emitir.error)}
        </p>
      ) : null}
      {sinLineas ? (
        <p role="alert" className="text-destructive text-sm">
          {t(`medicalClinic.orders.${kind}.empty`)}
        </p>
      ) : null}
      {children}
      <div data-testid="order-lines" className="flex flex-col gap-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("medicalClinic.orders.lines.concept")}</TableHead>
              <TableHead className="w-28">{t("medicalClinic.orders.lines.quantity")}</TableHead>
              {esReceta ? <TableHead>{t("medicalClinic.orders.lines.dosage")}</TableHead> : null}
              <TableHead className="w-28 text-right">
                {t("medicalClinic.orders.lines.price")}
              </TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.key}>
                <TableCell>
                  <span className="flex flex-col">
                    <span>{line.description}</span>
                    {line.kind === "medication" ? (
                      <span className="text-muted-foreground text-xs">{line.presentationName}</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  {line.kind === "medication" ? (
                    <Input
                      aria-label={t("medicalClinic.orders.lines.quantity")}
                      type="number"
                      inputMode={line.allowFractionalInput ? "decimal" : "numeric"}
                      min={line.allowFractionalInput ? 0.001 : 1}
                      step={line.allowFractionalInput ? "any" : 1}
                      value={line.quantity}
                      onChange={(e) =>
                        actualizar(line.key, (l) =>
                          l.kind === "medication"
                            ? {
                                ...l,
                                quantity: normalizeQuantity(e.target.value, l.allowFractionalInput),
                              }
                            : l,
                        )
                      }
                    />
                  ) : (
                    <span className="tabular-nums">1</span>
                  )}
                </TableCell>
                {esReceta ? (
                  <TableCell>
                    {line.kind === "medication" ? (
                      <Input
                        aria-label={t("medicalClinic.orders.lines.dosage")}
                        value={line.dosage}
                        maxLength={300}
                        onChange={(e) =>
                          actualizar(line.key, (l) =>
                            l.kind === "medication" ? { ...l, dosage: e.target.value } : l,
                          )
                        }
                      />
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">
                  {formatMoney(lineTotal(line), currency, locale)}
                </TableCell>
                <TableCell className="text-right">
                  <RowAction
                    type="button"
                    intent="delete"
                    onClick={() => onLinesChange(lines.filter((l) => l.key !== line.key))}
                  >
                    {t("medicalClinic.orders.lines.remove")}
                  </RowAction>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-right text-sm">
          <span className="text-muted-foreground">{t("medicalClinic.orders.total")}: </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(orderTotal(lines), currency, locale)}
          </span>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextAreaField
          className="sm:col-span-2"
          label={t("medicalClinic.orders.indications")}
          rows={4}
          value={indications}
          onChange={(e) => setIndications(e.target.value)}
          maxLength={2000}
        />
        <TextField
          className="sm:col-span-2"
          label={t("medicalClinic.orders.diagnosis")}
          value={diagnosis}
          onChange={(e) => setDiagnosis(e.target.value)}
          maxLength={300}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild type="button" variant="outline">
          <Link to="/medical-clinic/records/$recordId" params={{ recordId }}>
            {t("common.form.cancel")}
          </Link>
        </Button>
        <Button type="submit" disabled={emitir.isPending}>
          {t("medicalClinic.orders.save")}
        </Button>
      </div>
    </form>
  );
}
