import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PermissionGate } from "@/components/auth/permission-gate";

/**
 * F3-NAV-02 — placeholder hasta que llegue su módulo (F3-DOC-08).
 *
 * La ruta existe desde ahora para que el grupo de navegación no lleve a un
 * 404: un menú que ofrece algo que no está es peor que un menú más corto.
 */
function MovementsRoute() {
  const { t } = useTranslation();

  return (
    <PermissionGate need="inventory:read">
      <section className="flex flex-col gap-2">
        <h1 className="font-semibold text-xl">{t("inventory.nav.counts")}</h1>
        <p className="text-muted-foreground text-sm">{t("inventory.placeholder")}</p>
      </section>
    </PermissionGate>
  );
}

export const Route = createFileRoute("/movements/counts")({ component: MovementsRoute });
