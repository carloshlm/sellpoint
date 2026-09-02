import type { Currency } from "@sellpoint/shared";
import { createContext, type ReactNode, useContext } from "react";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-ADMIN-10 — el alcance con el que el dashboard y los reportes deciden a
 * QUIÉN miran.
 *
 * Por defecto miran al negocio de la sesión (`/reports`, permisos del rol).
 * Dentro del expediente del backoffice, el `AdminTenantScopeProvider` los
 * apunta a `/admin/tenants/:id` y les fuerza el permiso: el dueño de la
 * plataforma no tiene `reports:read` en el negocio ajeno, pero el server ya
 * lo dejó pasar por la guard del backoffice.
 *
 * Un CONTEXTO y no props en cascada: los widgets del dashboard son seis y
 * cada uno resuelve su propio hook; pasarles `basePath` uno a uno sería tocar
 * la misma línea seis veces cada vez que cambie.
 */
export interface AdminTenantScope {
  /** Prefijo del dashboard (`${basePath}/dashboard/*`). */
  basePath: string;
  /**
   * Prefijo de los reportes: `/reports` en la app propia y
   * `/admin/tenants/:id/reports` en el expediente — el API espeja `/reports/*`
   * bajo el negocio, así que NO es `basePath` a secas (bug cazado en sandbox).
   */
  reportsPath: string;
  /** El negocio ajeno que se mira, o null en la app del propio negocio. */
  tenantId: string | null;
  /** El backoffice ya pasó su guard: los gates de permiso del cliente no aplican. */
  forcePermission: boolean;
  /** La moneda del negocio que se mira (la del admin no sirve para sus números). */
  currency: Currency | null;
}

const DEFAULT_SCOPE: AdminTenantScope = {
  basePath: "/reports",
  reportsPath: "/reports",
  tenantId: null,
  forcePermission: false,
  currency: null,
};

const AdminTenantScopeContext = createContext<AdminTenantScope>(DEFAULT_SCOPE);

export function AdminTenantScopeProvider({
  tenantId,
  currency,
  children,
}: {
  tenantId: string;
  currency: Currency;
  children: ReactNode;
}) {
  return (
    <AdminTenantScopeContext.Provider
      value={{
        basePath: `/admin/tenants/${tenantId}`,
        reportsPath: `/admin/tenants/${tenantId}/reports`,
        tenantId,
        forcePermission: true,
        currency,
      }}
    >
      {children}
    </AdminTenantScopeContext.Provider>
  );
}

export function useAdminTenantScope(): AdminTenantScope {
  return useContext(AdminTenantScopeContext);
}

/** La moneda con la que se pintan los números: la del negocio mirado, o la propia. */
export function useScopedCurrency(): Currency {
  const { currency } = useAdminTenantScope();
  const propia = useAuthStore((s) => s.user?.tenant.currency);
  return (currency ?? propia ?? "MXN") as Currency;
}
