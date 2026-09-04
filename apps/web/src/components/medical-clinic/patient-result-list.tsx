import { Link } from "@tanstack/react-router";
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
          key={hit.customerId ?? `turn-${hit.turnId}`}
          data-testid={`patient-${hit.customerId ?? `turn-${hit.turnId}`}`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {/* Un turno sin cliente todavía no tiene a quién nombrar. */}
                {hit.customerId === null ? t("medicalClinic.attend.noPatientYet") : hit.name}
              </span>
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
                hit.customerId === null
                  ? null
                  : hit.lastRecord === null
                    ? t("medicalClinic.attend.noRecords")
                    : hit.lastRecord.lockReason === null
                      ? t("medicalClinic.attend.openToday", { folio: hit.lastRecord.folio })
                      : t("medicalClinic.attend.lastRecord", { folio: hit.lastRecord.folio }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* F9-CLINIC-WEB-29: quien ya tiene registro tiene algo que
                resumir; un turno sin paciente todavía no. Es LEER, así que
                no depende de poder escribir. */}
            {hit.customerId !== null && (
              <Button asChild variant="outline">
                <Link
                  to="/medical-clinic/patients/$customerId"
                  params={{ customerId: hit.customerId }}
                >
                  {t("medicalClinic.attend.summary")}
                </Link>
              </Button>
            )}
            {canStart &&
              // Con una consulta abierta HOY se CONTINÚA: un link al expediente,
              // sin alta de por medio. Vencida o cerrada, se abre folio nuevo.
              (hit.customerId !== null &&
              hit.lastRecord !== null &&
              hit.lastRecord.lockReason === null ? (
                <Link
                  to="/medical-clinic/records/$recordId"
                  params={{ recordId: hit.lastRecord.id }}
                  className={BOTON_CONTINUAR}
                >
                  {t("medicalClinic.attend.continue", { folio: hit.lastRecord.folio })}
                </Link>
              ) : (
                <Button type="button" disabled={starting !== null} onClick={() => onStart(hit)}>
                  {t("medicalClinic.attend.start")}
                </Button>
              ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Mismo peso visual que «Iniciar consulta»: es la acción principal de la tarjeta. */
const BOTON_CONTINUAR =
  "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring";
