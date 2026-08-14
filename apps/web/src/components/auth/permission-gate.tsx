import type * as React from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";

/**
 * D2 del design: gate declarativo de ruta/sección. Sin el permiso requerido
 * muestra un panel explicando el motivo — NUNCA redirige (redirigir esconde
 * por qué el usuario rebotó).
 */
function PermissionGate({ need, children }: { need: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const { has } = usePermissions();

  if (!has(need)) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-8 text-center"
      >
        <p className="text-lg font-semibold">{t("common.permissionGate.title")}</p>
        <p className="text-sm text-muted-foreground">{t("common.permissionGate.description")}</p>
      </div>
    );
  }

  return <>{children}</>;
}

export { PermissionGate };
