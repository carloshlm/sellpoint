import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { printTicket, type TicketWidth } from "@/lib/pos/api";

interface PrintTicketButtonProps {
  kind: "sale" | "quote";
  id: string;
  folio: string;
  width?: TicketWidth;
  label?: string;
  /** Imprime al montar, una vez por `id`; el botón queda para repetirlo. */
  autoPrint?: boolean;
}

/**
 * F4-TICKET-02 — imprimir el ticket.
 *
 * **Fallar no pierde nada**: la venta ya está cobrada y el papel se puede
 * volver a sacar del historial cuando se quiera. Por eso el error se avisa y
 * no se reintenta ni se bloquea nada — es el mismo criterio que el botón de
 * PDF de F3, donde el navegador no muestra NADA si una descarga falla y sin
 * este aviso el usuario cree que el archivo se bajó y no lo encuentra.
 *
 * Con `autoPrint` (Carlos, 2026-09-02) el ticket sale solo al aparecer el
 * aviso de venta cobrada, como el papel del turno; StrictMode monta dos veces
 * y la guarda por `id` evita dos papeles.
 */
export function PrintTicketButton({
  kind,
  id,
  folio,
  width,
  label,
  autoPrint = false,
}: PrintTicketButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const impreso = useRef<string | null>(null);

  const imprimir = () => {
    setBusy(true);
    setFailed(false);
    printTicket(kind, id, folio, width)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al montar, por ticket
  useEffect(() => {
    if (!autoPrint || impreso.current === id) return;
    impreso.current = id;
    imprimir();
  }, [autoPrint, id]);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" disabled={busy} onClick={imprimir}>
        {busy ? t("common.form.submitting") : (label ?? t("pos.ticket.print"))}
      </Button>
      {failed && (
        <span role="alert" className="text-destructive text-xs">
          {t("pos.ticket.failed")}
        </span>
      )}
    </div>
  );
}
