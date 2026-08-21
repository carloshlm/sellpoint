import { formatMoney } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CashboxSession } from "@/lib/pos/api";
import { useCloseSession, useSessionTotals } from "@/lib/pos/hooks";
import { SessionBar } from "./session-bar";

/**
 * El cierre con arqueo.
 *
 * Muestra lo CALCULADO por método y pide lo CONTADO. La diferencia se ve en
 * vivo mientras se teclea — y **no bloquea el botón**: cuadrar la caja es
 * tarea humana, y bloquear un turno descuadrado obligaría al cajero a
 * "encontrar" el número que el sistema quiere, escribiendo el calculado en vez
 * de lo que contó. El descuadre escondido se repite; el visible se investiga.
 */
export function CloseSession({ session }: { session: CashboxSession }) {
  const { t } = useTranslation();
  const { data } = useSessionTotals(true);
  const cerrar = useCloseSession();
  const [contado, setContado] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  const totales = data?.totals ?? [];
  const efectivo = Number(totales.find((x) => x.method === "cash")?.total ?? 0);
  const declarado = contado.trim() === "" ? null : Number(contado);
  const diferencia = declarado === null ? null : declarado - efectivo;

  return (
    <section className="flex max-w-md flex-col gap-4" data-testid="close-session">
      {/* Qué turno se está cerrando, con su almacén: cerrar el de otra
          sucursal por error es un descuadre que aparece al día siguiente. */}
      <SessionBar session={session} />
      <h1 className="font-semibold text-xl">{t("pos.session.closeTitle")}</h1>

      <div className="flex flex-col gap-1 rounded-md border border-input p-3 text-sm">
        {totales.map((linea) => (
          <div key={linea.method} className="flex justify-between">
            <span>
              {t(`pos.payment.${linea.method}`)}{" "}
              <span className="text-muted-foreground text-xs">
                ({t("pos.session.saleCount", { count: linea.count })})
              </span>
            </span>
            <span data-testid={`total-${linea.method}`} className="font-medium">
              {formatMoney(Number(linea.total))}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="declared-cash">{t("pos.session.declaredCash")}</Label>
        <Input
          id="declared-cash"
          type="number"
          min="0"
          step="0.01"
          value={contado}
          onChange={(event) => setContado(event.target.value)}
        />
      </div>

      {/* La diferencia se MUESTRA, nunca frena. Ver el docblock. */}
      {diferencia !== null && (
        <p data-testid="cash-difference" className="text-sm">
          {t("pos.session.difference")}:{" "}
          <span className={diferencia === 0 ? "font-medium" : "font-medium text-destructive"}>
            {formatMoney(diferencia)}
          </span>
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="closing-note">{t("pos.session.note")}</Label>
        <Input
          id="closing-note"
          value={nota}
          onChange={(event) => setNota(event.target.value)}
          placeholder={t("pos.session.notePlaceholder")}
        />
      </div>

      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      <Button
        disabled={declarado === null || cerrar.isPending}
        onClick={() => {
          setError(null);
          cerrar.mutate(
            { declaredCash: declarado ?? 0, ...(nota.trim() !== "" && { note: nota.trim() }) },
            { onError: (e) => setError(e.message || t("pos.session.closeFailed")) },
          );
        }}
      >
        {cerrar.isPending ? t("common.form.submitting") : t("pos.session.close")}
      </Button>
      <p className="text-muted-foreground text-xs">{t("pos.session.closeHint")}</p>
    </section>
  );
}
