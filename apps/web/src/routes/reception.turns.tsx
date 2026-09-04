import { localCalendarDate } from "@sellpoint/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { ReceptionItemGate } from "@/components/reception/reception-item-gate";
import { TurnNumberDialog } from "@/components/reception/turn-number-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import { printTurnTicket, type Turn } from "@/lib/reception/api";
import { useAttendTurn, useCreateTurn, useTurns, useWaitTurn } from "@/lib/reception/hooks";
import { useReceptionEntity } from "@/lib/reception/settings";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/reception/turns")({
  component: TurnsPage,
});

/** F9-RECEP-13 — «Generar turno»: los turnos del día, del mayor al menor. */
function TurnsPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reception:read">
            <ReceptionItemGate item="turns">
              <TurnsContent />
            </ReceptionItemGate>
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function TurnsContent() {
  const { t, i18n } = useTranslation();
  const entidad = useReceptionEntity();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("reception:manage") && canWrite;
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const locale = i18n.language === "en" ? "en-US" : "es-MX";

  // El día del negocio de HOY, por defecto: la pregunta de la pantalla es
  // «¿por quién vamos?», y la de ayer, «¿cuántos atendimos?».
  const [dia, setDia] = useState(() => localCalendarDate(timeZone ?? "UTC", new Date()));
  const { data, isPending } = useTurns({ date: dia });
  const [turno, setTurno] = useState<Turn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createTurn = useCreateTurn();
  const attendTurn = useAttendTurn();
  const waitTurn = useWaitTurn();
  const onError = (apiError: ApiError) => setError(apiError.message);
  // Reimprimir es LEER (Carlos, 2026-09-02): cualquiera con reception:read
  // vuelve a sacar el papel de una fila, se haya atendido o no.
  const reimprimir = (turn: Turn) => {
    setError(null);
    printTurnTicket(turn.id, turn.number).catch(() => setError(t("reception.turns.printFailed")));
  };

  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("reception.turns.title")}</h1>
        {canManage && (
          <Button
            type="button"
            disabled={createTurn.isPending}
            onClick={() => {
              setError(null);
              createTurn.mutate({}, { onSuccess: setTurno, onError });
            }}
          >
            {t("reception.turns.issue")}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="turns-date">{t("reception.turns.date")}</Label>
        <Input
          id="turns-date"
          type="date"
          value={dia}
          onChange={(event) => {
            if (event.target.value) {
              setDia(event.target.value);
            }
          }}
          className="max-w-xs"
        />
      </div>

      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="turns-empty" className="text-muted-foreground text-sm">
          {t("reception.turns.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2">{t("reception.turns.columns.number")}</TableHead>
              <TableHead className="px-2">
                {t("reception.turns.columns.customer", entidad.vars)}
              </TableHead>
              <TableHead className="px-2">{t("reception.turns.columns.status")}</TableHead>
              <TableHead className="px-2">{t("reception.turns.columns.time")}</TableHead>
              <TableHead className="px-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((turn) => (
              <TableRow
                key={turn.id}
                data-testid={`turn-${turn.id}`}
                className={turn.status === "attended" ? "text-muted-foreground" : ""}
              >
                <TableCell className="px-2 font-bold text-3xl tabular-nums">
                  {turn.number}
                </TableCell>
                <TableCell className="px-2">
                  {turn.customerName ?? t("reception.turns.noCustomer", entidad.vars)}
                </TableCell>
                <TableCell className="px-2">
                  <Badge variant={turn.status === "attended" ? "success" : "warning"}>
                    {t(`reception.turns.status.${turn.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="px-2 whitespace-nowrap">
                  {formatBusinessDate(turn.createdAt, locale, timeZone, true)}
                </TableCell>
                <TableCell className="px-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => reimprimir(turn)}
                    >
                      {t("reception.turns.reprint")}
                    </Button>
                    {canManage &&
                      (turn.status === "waiting" ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={attendTurn.isPending}
                          onClick={() => {
                            setError(null);
                            attendTurn.mutate(turn.id, { onError });
                          }}
                        >
                          {t("reception.turns.attend")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={waitTurn.isPending}
                          onClick={() => {
                            setError(null);
                            waitTurn.mutate(turn.id, { onError });
                          }}
                        >
                          {t("reception.turns.wait")}
                        </Button>
                      ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {turno && <TurnNumberDialog turn={turno} onClose={() => setTurno(null)} />}
    </div>
  );
}
