import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import type { RecordSummary } from "@/lib/medical-clinic/api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-CLINIC-WEB-28 — la tabla de historias clínicas, la MISMA en el buscador
 * y en el resumen del paciente. Con el componente `Table` de la casa:
 * encabezado con fondo, fila resaltada, aviso de scroll (skill
 * sellpoint-tables). El estado se pinta con el candado que ya calcula el API
 * —abierta, cerrada o vencida— y la acción cambia con él: una abierta de hoy
 * se CONTINÚA, cualquier otra se abre a leer.
 */
export function RecordsTable({
  rows,
  showPatient,
}: {
  rows: RecordSummary[];
  /** En el resumen de UN paciente la columna sobra. */
  showPatient: boolean;
}) {
  const { t, i18n } = useTranslation();
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const locale = i18n.language === "en" ? "en-US" : "es-MX";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="px-2">{t("medicalClinic.history.columns.folio")}</TableHead>
          {showPatient && (
            <TableHead className="px-2">{t("medicalClinic.history.columns.patient")}</TableHead>
          )}
          <TableHead className="px-2">{t("medicalClinic.history.columns.date")}</TableHead>
          <TableHead className="px-2">{t("medicalClinic.history.columns.doctor")}</TableHead>
          <TableHead className="px-2">{t("medicalClinic.history.columns.status")}</TableHead>
          <TableHead className="px-2" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((fila) => {
          const estado = fila.lockReason ?? "open";
          return (
            <TableRow key={fila.id}>
              <TableCell className="px-2 font-mono">{fila.folio}</TableCell>
              {showPatient && <TableCell className="px-2">{fila.patientName}</TableCell>}
              <TableCell className="px-2 whitespace-nowrap">
                {formatBusinessDate(`${fila.consultationDate}T12:00:00Z`, locale, timeZone)}
              </TableCell>
              <TableCell className="px-2">{fila.doctorName}</TableCell>
              <TableCell className="px-2">
                <Badge variant={estado === "open" ? "success" : "default"}>
                  {t(`medicalClinic.consultationStatus.${estado}`)}
                </Badge>
              </TableCell>
              <TableCell className="px-2 text-right whitespace-nowrap">
                <Link
                  to="/medical-clinic/records/$recordId"
                  params={{ recordId: fila.id }}
                  className="inline-flex h-8 items-center px-3 font-medium text-primary text-sm hover:underline"
                >
                  {fila.lockReason === null
                    ? t("medicalClinic.history.continue")
                    : t("medicalClinic.history.open")}
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
