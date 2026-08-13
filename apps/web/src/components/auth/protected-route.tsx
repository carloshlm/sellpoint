import { Navigate } from "@tanstack/react-router";
import type * as React from "react";

import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-AUTH-08: sin token en memoria → redirige a /login. Es reactivo al
 * store, así un logout (o un refresh fallido cuando llegue F1-WEB-AUTH-02)
 * expulsa al usuario de la vista protegida al instante.
 *
 * NOTA: hasta que exista el interceptor de refresh (F1-WEB-AUTH-02), recargar
 * la página pierde el token en memoria y siempre redirige a /login.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((state) => state.accessToken);

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export { ProtectedRoute };
