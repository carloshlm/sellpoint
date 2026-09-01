import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ScrollableList } from "@/components/ui/scrollable-list";
import { usePermissions } from "@/lib/auth/permissions";
import { useExpiring } from "@/lib/inventory/hooks";

/**
 * F3-LOTS-03, rediseñada con el panel (Carlos, 2026-09-01) — el aviso de
 * caducidades ya no es un conteo mudo: dice QUÉ vence, con lote y semáforo de
 * días, lo más urgente primero. Un «9» sin nombres obliga a navegar para
 * saber si es grave; tres filas cuentan la historia sin salir del panel.
 *
 * **Solo aparece si hay algo que avisar** (criterio original intacto): un
 * negocio sin lotes nunca tiene filas y uno sano no necesita una tarjeta que
 * diga «0». Sin permiso no se consulta siquiera.
 */
export function ExpiringCard() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const puedeVer = has("inventory:read");
  const { data } = useExpiring({ days: 30 }, { enabled: puedeVer });

  const total = data?.length ?? 0;
  if (!puedeVer || total === 0 || data === undefined) {
    return null;
  }

  // Lo más urgente primero; lo vencido (daysLeft negativo) encabeza solo.
  const urgentes = [...data].sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 3);

  return (
    <section
      data-testid="expiring-card"
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-medium text-sm">{t("inventory.expiring.card")}</h2>
        <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-semibold text-destructive text-sm">
          {total}
        </span>
      </div>
      {/* Caja deslizable con `min-w`: en un celular las filas no caben y sin
          scroll se cortaban en el borde (revisión móvil, Carlos 2026-08-31). */}
      <ScrollableList>
        <ul className="flex min-w-[24rem] flex-col gap-1 text-sm">
          {urgentes.map((fila) => (
            <li key={fila.lot.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{fila.name}</span>
              <span className="text-muted-foreground text-xs">{fila.lot.lotCode}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {Number(fila.quantity)} u
              </span>
              <span
                className={
                  fila.expired || fila.daysLeft <= 7
                    ? "text-destructive text-xs tabular-nums"
                    : "text-warning text-xs tabular-nums"
                }
              >
                {fila.expired
                  ? t("inventory.expiring.expired")
                  : t("inventory.expiring.daysLeft", { count: fila.daysLeft })}
              </span>
            </li>
          ))}
        </ul>
      </ScrollableList>
      <Link to="/movements/expiring" className="w-fit text-primary text-sm hover:underline">
        {t("inventory.expiring.viewAll")} →
      </Link>
    </section>
  );
}
