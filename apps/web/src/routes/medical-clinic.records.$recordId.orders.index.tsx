import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { RowAction } from "@/components/ui/row-action";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MedicalOrder } from "@/lib/medical-clinic/api";
import { printMedicalOrder } from "@/lib/medical-clinic/api";
import { useCancelOrder, useOrders, useRecord } from "@/lib/medical-clinic/hooks";

export const Route = createFileRoute("/medical-clinic/records/$recordId/orders/")({
  component: OrdersPage,
});

function OrdersPage() {
  const { recordId } = Route.useParams();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <OrdersScreen recordId={recordId} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * Lo que el consultorio quiere saber de una orden es si el paciente RECIBIÓ
 * lo que se le ordenó, no cuánto costó (Carlos, 2026-09-04). Hoy eso se
 * deduce del cobro: lo que pasó por caja se proporcionó; lo demás, todavía
 * no. El importe vive en la cotización y en el ticket, no acá.
 */
const PROVIDED_VARIANT = {
  charged: "success",
  pending: "default",
  not_for_sale: "default",
} as const;
const proporcionado = (chargeStatus: keyof typeof PROVIDED_VARIANT) => chargeStatus === "charged";

/**
 * F9-CLINIC-WEB-19/22 — las órdenes de la consulta con su estado de cobro.
 * «Cancelar» solo mientras no se haya cobrado (el API lo vuelve a comprobar);
 * «Imprimir» abre el documento carta.
 */
function OrdersScreen({ recordId }: { recordId: string }) {
  const { t } = useTranslation();
  const record = useRecord(recordId);
  const ordenes = useOrders(recordId);
  const cancelar = useCancelOrder(recordId);
  const [aCancelar, setACancelar] = useState<MedicalOrder | null>(null);
  const [errorImpresion, setErrorImpresion] = useState(false);

  if (ordenes.isPending) return <p role="status">{t("common.form.loading")}</p>;
  if (ordenes.isError) return <p role="alert">{t("medicalClinic.record.loadFailed")}</p>;

  return (
    <div className="flex flex-col gap-4">
      {record.data ? (
        <Link
          to="/medical-clinic/records/$recordId"
          params={{ recordId }}
          className="w-fit text-muted-foreground text-sm underline-offset-2 hover:underline"
        >
          ← {t("medicalClinic.record.back", { folio: record.data.folio })}
        </Link>
      ) : null}
      <h1 className="font-semibold text-2xl">{t("medicalClinic.orders.list.title")}</h1>
      {cancelar.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("medicalClinic.orders.list.cancelFailed")}
        </p>
      ) : null}
      {errorImpresion ? (
        <p role="alert" className="text-destructive text-sm">
          {t("medicalClinic.orders.printFailed")}
        </p>
      ) : null}
      {ordenes.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("medicalClinic.orders.list.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("medicalClinic.orders.list.columns.folio")}</TableHead>
              <TableHead>{t("medicalClinic.orders.list.columns.kind")}</TableHead>
              <TableHead>{t("medicalClinic.orders.list.columns.items")}</TableHead>
              <TableHead>{t("medicalClinic.orders.list.columns.status")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenes.data.map((orden) => (
              <TableRow key={orden.id} data-testid={`order-${orden.id}`}>
                <TableCell className="font-mono">{orden.folio}</TableCell>
                <TableCell>{t(`medicalClinic.orders.kinds.${orden.kind}`)}</TableCell>
                <TableCell className="max-w-xs truncate">
                  {orden.lines.map((l) => l.description).join(", ")}
                </TableCell>
                <TableCell>
                  {orden.status === "canceled" ? (
                    <Badge variant="destructive">{t("medicalClinic.orders.list.canceled")}</Badge>
                  ) : (
                    <Badge variant={PROVIDED_VARIANT[orden.chargeStatus]}>
                      {t(
                        `medicalClinic.orders.list.provided.${
                          proporcionado(orden.chargeStatus) ? "yes" : "no"
                        }`,
                      )}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <RowAction
                    intent="view"
                    onClick={() => {
                      setErrorImpresion(false);
                      printMedicalOrder(orden.id, orden.folio).catch(() => setErrorImpresion(true));
                    }}
                  >
                    {t("medicalClinic.orders.print")}
                  </RowAction>
                  {orden.status === "issued" && orden.chargeStatus !== "charged" ? (
                    <RowAction intent="delete" onClick={() => setACancelar(orden)}>
                      {t("medicalClinic.orders.list.cancel")}
                    </RowAction>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {aCancelar ? (
        <ConfirmDialog
          title={t("medicalClinic.orders.list.cancelTitle", { folio: aCancelar.folio })}
          body={t("medicalClinic.orders.list.cancelBody")}
          confirmLabel={t("medicalClinic.orders.list.cancelConfirm")}
          cancelLabel={t("common.form.cancel")}
          busy={cancelar.isPending}
          onCancel={() => setACancelar(null)}
          onConfirm={() => cancelar.mutate(aCancelar.id, { onSettled: () => setACancelar(null) })}
        />
      ) : null}
    </div>
  );
}
