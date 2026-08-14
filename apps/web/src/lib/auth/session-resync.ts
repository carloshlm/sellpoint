import { getMe } from "@/lib/auth/api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-USERS WU6 (D3 del design, hallazgo 1 del proposal). El JWT se
 * refresca solo para el BACKEND vía el interceptor de F1-WEB-AUTH-02 (401
 * `token_stale` cuando el epoch de tenant/usuario avanzó). Eso NO actualiza
 * `user.permissions` del store — el interceptor solo reemplaza el token, no
 * vuelve a pedir `/me`. `resyncSession()` es la pieza que falta: trae la
 * identidad fresca y la escribe en el store para que `usePermissions()` (nav,
 * `PermissionGate`, `canManage`) refleje los permisos nuevos en la misma
 * pestaña, sin logout.
 *
 * `setUser` (auth.store) ya es no-op sin sesión previa — evita revivir una
 * sesión fantasma si esto se llamara sin login activo.
 */
export async function resyncSession(): Promise<void> {
  const user = await getMe();
  useAuthStore.getState().setUser(user);
}
