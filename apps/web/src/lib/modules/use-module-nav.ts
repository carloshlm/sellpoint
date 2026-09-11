import type { ModuleKey } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { hiddenReceptionRoutes, useReceptionEntity } from "@/lib/reception/settings";
import { useAuthStore } from "@/stores/auth.store";
import { MODULE_NAV_ENTRIES, type ModuleNavLink } from "./nav";

export interface ResolvedModuleNavGroup {
  key: ModuleKey;
  label: string;
  links: { to: string; label: string; icon: ModuleNavLink["icon"] }[];
}

/**
 * F9-RECEP-18 — el menú de los módulos avanzados, ya RESUELTO: filtrado por
 * módulo activo y por permiso (como siempre), y además por la configuración
 * del negocio — Recepción puede apagar entradas y llamar «paciente» a su
 * cliente, y eso se ve en la etiqueta del link.
 *
 * Vive fuera del layout para que `app-layout.tsx` siga sin saber de ningún
 * módulo en particular: él pinta lo que este hook le da.
 */
export function useModuleNav(): ResolvedModuleNavGroup[] {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { hasModule } = usePlan();
  const recepcion = useReceptionEntity();
  const ocultas = hiddenReceptionRoutes(recepcion.settings);
  // F9-PO-11: un enlace puede depender de un ajuste del negocio (`when`).
  const tenant = useAuthStore((s) => s.user?.tenant);
  // Solo Recepción interpola una palabra propia; el resto no lleva variables.
  const variablesDe = (key: ModuleKey) => (key === "reception" ? recepcion.vars : undefined);

  // F9-SUPPL-09 — un enlace que vive en dos grupos (Proveedores, en Compras y
  // en Gastos) se pinta UNA vez: gana la primera aparición en el orden de
  // `MODULE_KEYS`. Se deduplica por RUTA, no por etiqueta: la ruta es la
  // identidad del destino; la etiqueta es solo cómo se llama.
  const vistas = new Set<string>();
  return MODULE_NAV_ENTRIES.filter(([key]) => hasModule(key))
    .map(([key, grupo]) => ({
      key,
      label: t(grupo.labelKey),
      links: grupo.links
        .filter((link) => has(link.permission) && !ocultas.has(link.to))
        .filter((link) => link.when === undefined || (tenant !== undefined && link.when(tenant)))
        .filter((link) => {
          if (vistas.has(link.to)) return false;
          vistas.add(link.to);
          return true;
        })
        .map((link) => ({
          to: link.to,
          icon: link.icon,
          label: t(link.labelKey, variablesDe(key)),
        })),
    }))
    .filter((grupo) => grupo.links.length > 0);
}
