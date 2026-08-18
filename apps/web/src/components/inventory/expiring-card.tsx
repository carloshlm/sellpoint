import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import { useExpiring } from "@/lib/inventory/hooks";

/**
 * F3-LOTS-03 — el aviso de caducidades en el dashboard.
 *
 * **Solo aparece si hay algo que avisar.** El tablero la pedía condicionada a
 * que el tenant tuviera productos con `tracks_lots`; se condiciona a que HAYA
 * filas por vencer, que es más estricto y no necesita un endpoint nuevo: un
 * negocio sin lotes nunca tiene filas, y uno con lotes pero nada por vencer
 * tampoco necesita una tarjeta que diga "0".
 *
 * 30 días es el plazo del aviso; la pantalla completa deja cambiarlo.
 */
export function ExpiringCard() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const puedeVer = has("inventory:read");
  // Sin permiso no se consulta siquiera: pedir algo que no se va a poder
  // mostrar es un 403 anunciado.
  const { data } = useExpiring({ days: 30 }, { enabled: puedeVer });

  const total = data?.length ?? 0;
  if (!puedeVer || total === 0) {
    return null;
  }

  return (
    <Link
      to="/movements/expiring"
      data-testid="expiring-card"
      className="flex w-fit items-center gap-3 rounded-lg border border-input px-4 py-3 text-sm hover:bg-muted"
    >
      <span className="font-medium">{t("inventory.expiring.card")}</span>
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-semibold text-destructive">
        {total}
      </span>
    </Link>
  );
}
