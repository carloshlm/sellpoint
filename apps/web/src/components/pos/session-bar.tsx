import { useTranslation } from "react-i18next";
import type { CashboxSession } from "@/lib/pos/api";

/**
 * La barra del POS: **desde qué almacén se está vendiendo**.
 *
 * Cierra la deuda de F3-HOME-05 sobre VISTAS §9.1. No es decoración: el
 * vendedor tiene que saber de dónde está descontando. Un cajero que rota entre
 * sucursales y no ve cuál abrió puede vender media mañana contra el inventario
 * equivocado, y el error solo aparece al cuadrar.
 */
export function SessionBar({ session }: { session: CashboxSession }) {
  const { t, i18n } = useTranslation();
  const desde = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(session.openedAt));

  return (
    <div
      data-testid="session-bar"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-input px-3 py-2 text-sm"
    >
      <span className="font-medium">🛒 {t("pos.title")}</span>
      <span aria-hidden>·</span>
      <span data-testid="session-warehouse" className="font-medium">
        {session.warehouse.name}
      </span>
      <span aria-hidden>·</span>
      <span className="text-muted-foreground">{t("pos.session.openSince", { time: desde })}</span>
    </div>
  );
}
