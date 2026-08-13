import { Navigate } from "@tanstack/react-router";
import type * as React from "react";

import { SessionLoading } from "@/components/auth/session-loading";
import { useSessionStatus } from "@/lib/auth/session-bootstrap";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-AUTH-08 + bootstrap: la decisión es en este orden —
 * 1. Hay token en memoria → sesión viva, se renderiza (da igual el bootstrap:
 *    un login en caliente ya autenticó).
 * 2. No hay token pero el bootstrap sigue `pending` → todavía no sabemos si
 *    la cookie de refresh vale; mostrar carga y NO redirigir (evita el flash
 *    de /login al recargar estando logueado).
 * 3. No hay token y el bootstrap terminó → sesión muerta, a /login. Reactivo
 *    al store: un logout o un refresh fallido expulsan al instante.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const status = useSessionStatus();

  if (accessToken) {
    return <>{children}</>;
  }

  if (status === "pending") {
    return <SessionLoading />;
  }

  return <Navigate to="/login" replace />;
}

export { ProtectedRoute };
