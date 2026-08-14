import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-USERS WU2 (D1 del design). Gating de UI: `hasPermission` es pura
 * (testeable sin React ni store) y `usePermissions()` la envuelve sobre
 * `auth.store.user.permissions`. Nav y ruta gatean por `:read`; `canManage`
 * SIEMPRE viaja como prop a los presentacionales (nunca leen el store
 * directo) para que sigan testeables sin store y el modo solo-lectura sea
 * explícito en la firma del componente.
 */
export function hasPermission(user: AuthUser | null, code: string): boolean {
  if (!user) {
    return false;
  }
  return user.permissions.includes(code);
}

export function usePermissions() {
  const user = useAuthStore((state) => state.user);

  return {
    has: (code: string) => hasPermission(user, code),
  };
}
