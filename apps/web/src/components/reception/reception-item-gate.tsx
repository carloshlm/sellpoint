import type { ReceptionMenuItem } from "@sellpoint/shared";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { isReceptionItemVisible, useReceptionEntity } from "@/lib/reception/settings";

/**
 * F9-RECEP-18 — una entrada de Recepción que el negocio apagó no se abre
 * por la URL. Como todo gate de la casa, NO redirige: dice qué pasó y quién
 * lo puede cambiar. Mientras la configuración carga se deja pasar — es una
 * preferencia de menú, no un permiso; el permiso lo cuida `PermissionGate`.
 */
export function ReceptionItemGate({
  item,
  children,
}: {
  item: ReceptionMenuItem;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { settings, isPending } = useReceptionEntity();

  if (!isPending && !isReceptionItemVisible(settings, item)) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-8 text-center"
      >
        <p className="font-semibold text-lg">{t("reception.settings.itemHidden.title")}</p>
        <p className="text-muted-foreground text-sm">
          {t("reception.settings.itemHidden.description")}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
