import { type Currency, formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import { useSession, useSessionTotals } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * El Panel de quien VENDE (Carlos, 2026-09-12: «¿qué podría ver un vendedor?
 * para que no salga así en blanco»).
 *
 * ── Qué se puede mostrar y qué no ───────────────────────────────────────
 *
 * Un Seller tiene `pos:sell`, `pos:quote`, `pos:view`, `products:read` y
 * `services:read`. NO tiene `reports:read`, así que las ventas del negocio,
 * la utilidad y los tops no son suyos y no se pintan (ese gateo ya vive en
 * cada widget). Pero SU TURNO sí es suyo: lo abre él, cobra él y lo cierra
 * él, y el API se lo da con `pos:sell` (`/pos/session`, `/pos/session/totals`).
 *
 * Por eso esta tarjeta no es «el panel recortado»: es otro panel. Responde
 * las tres preguntas del mostrador al llegar —¿tengo turno abierto?, ¿cuánto
 * llevo cobrado?, ¿por dónde sigo?— y ninguna de ellas es un reporte del
 * negocio. Un número que sí es del negocio (cuánto vendió el local hoy)
 * seguiría fuera aunque quedara hueco: el hueco es la respuesta correcta.
 *
 * Se pinta SOLO cuando la persona no puede ver reportes: quien sí puede ya
 * tiene sus KPIs arriba y esto sería ruido.
 */
export function SellerPanel() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant?.currency) ?? "MXN") as Currency;

  const puedeVender = has("pos:sell");
  const esDelMostrador = puedeVender && !has("reports:read");
  const { data: sesion } = useSession(esDelMostrador);
  const turno = sesion?.session ?? null;
  const abierto = turno !== null && turno.status === "open";
  const { data: arqueo } = useSessionTotals(esDelMostrador && abierto);

  if (!esDelMostrador) {
    return null;
  }

  const vendido = (arqueo?.totals ?? []).reduce((suma, fila) => suma + Number(fila.total), 0);
  const tickets = (arqueo?.totals ?? []).reduce((suma, fila) => suma + fila.count, 0);
  const desde =
    turno === null
      ? null
      : new Date(turno.openedAt).toLocaleTimeString(locale === "en" ? "en-US" : "es-MX", {
          hour: "2-digit",
          minute: "2-digit",
        });

  return (
    <section
      data-testid="seller-panel"
      aria-labelledby="seller-panel-title"
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
    >
      <h2 id="seller-panel-title" className="font-medium">
        {t("dashboard.seller.title")}
      </h2>

      {abierto ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm" data-testid="seller-shift">
            {t("pos.session.openSince", { time: desde })}
            {turno !== null && ` · ${turno.warehouse.name}`}
          </p>
          {/* Lo cobrado en SU turno, no lo vendido por el negocio. */}
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">{t("dashboard.seller.charged")}</span>
              <span className="font-semibold text-2xl tabular-nums" data-testid="seller-charged">
                {formatMoney(vendido, currency, locale)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">{t("dashboard.seller.tickets")}</span>
              <span className="font-semibold text-2xl tabular-nums" data-testid="seller-tickets">
                {tickets}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm" data-testid="seller-shift">
          {t("dashboard.seller.noShift")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Los accesos de siempre, por permiso: el mostrador entra a vender
            con un clic, no buscando en el menú. */}
        <Link
          to="/pos"
          className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm"
        >
          {abierto ? t("pos.nav.sell") : t("pos.session.open")}
        </Link>
        {has("pos:quote") && (
          <Link to="/pos/quotes" className="rounded-md border px-3 py-2 text-sm">
            {t("pos.nav.quote")}
          </Link>
        )}
        {has("pos:view") && (
          <Link to="/pos/sales" className="rounded-md border px-3 py-2 text-sm">
            {t("pos.nav.history")}
          </Link>
        )}
        {abierto && (
          <Link to="/pos/close" className="rounded-md border px-3 py-2 text-sm">
            {t("pos.nav.close")}
          </Link>
        )}
      </div>
    </section>
  );
}
