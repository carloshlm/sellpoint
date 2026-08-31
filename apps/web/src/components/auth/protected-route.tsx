import { Navigate } from "@tanstack/react-router";
import type * as React from "react";

import { SessionLoading } from "@/components/auth/session-loading";
import { SessionUnavailable } from "@/components/auth/session-unavailable";
import { useSessionStatus } from "@/lib/auth/session-bootstrap";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-AUTH-08 + bootstrap: la decisión es en este orden —
 * 1. Hay token en memoria → sesión viva, se renderiza (da igual el bootstrap:
 *    un login en caliente ya autenticó).
 * 2. No hay token pero el bootstrap sigue `pending` → todavía no sabemos si
 *    la cookie de refresh vale; mostrar carga y NO redirigir (evita el flash
 *    de /login al recargar estando logueado).
 * 3. El bootstrap no PUDO confirmar la sesión por algo temporal (429 del
 *    límite de volumen, 5xx, red caída) → `unavailable`: se ofrece reintentar
 *    en vez de expulsar. La cookie puede seguir viva, y mandar a /login le
 *    haría perder lo que estuviera haciendo (Carlos, 2026-08-31: quince
 *    recargas rápidas lo sacaron de una sesión perfectamente válida).
 * 4. No hay token y el bootstrap terminó → sesión muerta, a /login. Reactivo
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

  if (status === "unavailable") {
    return <SessionUnavailable />;
  }

  return <Navigate to="/login" replace />;
}

export { ProtectedRoute };
