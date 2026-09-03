import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import type { PatientHit } from "@/lib/medical-clinic/api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-CLINIC-WEB-07 — los aciertos, como tarjetas (por turno hay uno; por
 * nombre, un puñado). «Iniciar consulta» exige un clic aunque haya un solo
 * acierto: un turno mal tecleado abriría un expediente al paciente
 * equivocado, y ese folio ya no se recupera.
 */
export function PatientResultList({
  hits,
  canStart,
  starting,
  onStart,
}: {
  hits: PatientHit[];
  canStart: boolean;
  starting: string | null;
  onStart: (hit: PatientHit) => void;
}) {
  const { t, i18n } = useTranslation();
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const locale = i18n.language === "en" ? "en-US" : "es-MX";

  return (
    <ul className="flex flex-col gap-2">
      {hits.map((hit) => (
        <li
          key={hit.customerId}
          data-testid={`patient-${hit.customerId}`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{hit.name}</span>
              {hit.turnNumber !== null && (
                <Badge variant="warning">
                  {t("medicalClinic.attend.turnBadge", { number: hit.turnNumber })}
                </Badge>
              )}
            </div>
            <span className="text-muted-foreground text-xs">
              {[
                hit.age === null ? null : t("medicalClinic.attend.years", { count: hit.age }),
                hit.birthDate === null
                  ? null
                  : formatBusinessDate(`${hit.birthDate}T12:00:00Z`, locale, timeZone),
                hit.lastRecord === null
                  ? t("medicalClinic.attend.noRecords")
                  : t("medicalClinic.attend.lastRecord", { folio: hit.lastRecord.folio }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          {canStart && (
            <Button type="button" disabled={starting !== null} onClick={() => onStart(hit)}>
              {t("medicalClinic.attend.start")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
