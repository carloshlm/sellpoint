import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import { printTurnTicket, type Turn } from "@/lib/reception/api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-RECEP-11/13 — el turno recién generado, como el PAPEL que se imprime.
 *
 * Al abrirse dispara la impresión (Carlos, 2026-09-02): el papel sale de la
 * misma térmica que el ticket de venta, como PDF del servidor con su ancho
 * (58 mm por defecto), y el diálogo lo muestra igual —negocio, TURNO, el
 * número en grande, el cliente y la fecha y hora—, todo centrado, para que
 * la recepcionista lo dicte aunque la impresora no responda.
 *
 * Fallar no pierde nada: el turno ya existe y «Imprimir de nuevo» lo vuelve
 * a pedir.
 */
export function TurnNumberDialog({ turn, onClose }: { turn: Turn; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const nombreNegocio = useAuthStore(
    (state) => state.user?.tenant?.legalName ?? state.user?.tenant?.name ?? "",
  );
  const locale = i18n.language === "en" ? "en-US" : "es-MX";
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** El turno cuyo papel ya salió: StrictMode monta dos veces y la térmica no lo sabe. */
  const impreso = useRef<string | null>(null);

  const imprimir = () => {
    setBusy(true);
    setFailed(false);
    printTurnTicket(turn.id, turn.number)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  // La impresión sale sola al abrir: un clic menos por cada persona que llega.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al montar, por turno
  useEffect(() => {
    if (impreso.current === turn.id) return;
    impreso.current = turn.id;
    imprimir();
  }, [turn.id]);

  return (
    <Dialog open onClose={onClose} title={t("reception.turns.issued")}>
      <div className="flex flex-col items-center gap-4 py-2">
        <div
          data-testid="turn-ticket"
          className="flex w-full max-w-xs flex-col items-center gap-1 rounded-md border border-dashed bg-background px-6 py-5 text-center"
        >
          <p className="font-semibold text-sm">{nombreNegocio}</p>
          <p className="mt-2 text-muted-foreground text-xs uppercase tracking-[0.3em]">
            {t("reception.turns.ticketLabel")}
          </p>
          <p data-testid="turn-number" className="font-bold text-8xl tabular-nums leading-none">
            {turn.number}
          </p>
          {turn.customerName && <p className="mt-2 text-sm">{turn.customerName}</p>}
          <p className="text-muted-foreground text-xs">
            {formatBusinessDate(turn.createdAt, locale, timeZone, true)}
          </p>
        </div>
        {failed && (
          <p role="alert" className="text-destructive text-xs">
            {t("reception.turns.printFailed")}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={imprimir}>
            {t("reception.turns.print")}
          </Button>
          <Button type="button" onClick={onClose}>
            {t("reception.turns.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
