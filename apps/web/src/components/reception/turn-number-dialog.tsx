import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Turn } from "@/lib/reception/api";

/**
 * F9-RECEP-11/13 — el número del turno recién generado, en GRANDE.
 *
 * Un diálogo y no un toast: la recepcionista lo dicta en voz alta (o se lo
 * enseña a la persona) y un toast se va solo a los cuatro segundos.
 */
export function TurnNumberDialog({ turn, onClose }: { turn: Turn; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onClose={onClose} title={t("reception.turns.issued")}>
      <div className="flex flex-col items-center gap-4 py-4">
        <p data-testid="turn-number" className="font-bold text-8xl tabular-nums leading-none">
          {turn.number}
        </p>
        <p className="text-muted-foreground text-sm">
          {turn.customerName
            ? t("reception.turns.issuedFor", { name: turn.customerName })
            : t("reception.turns.noCustomer")}
        </p>
        <Button type="button" onClick={onClose}>
          {t("reception.turns.close")}
        </Button>
      </div>
    </Dialog>
  );
}
