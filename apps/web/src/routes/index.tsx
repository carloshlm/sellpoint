import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * F10-MANFIX-09 — `/` no es una pantalla: lleva al panel, sin pintar nada.
 *
 * Era la página de prueba de la Fase 0 («Total demo», «Tailwind activo»,
 * «Probar»), pública y sin enlace a nada. En producción `app.sellpointy.com/`
 * caía ahí (nginx sirve el SPA con `try_files`) y la app instalada también,
 * porque el `start_url` del manifiesto es `/`: sin barra de direcciones, el
 * usuario quedaba atrapado.
 *
 * `/dashboard` decide lo demás: con sesión, el panel; sin ella,
 * `ProtectedRoute` manda a `/login`. `replace` para que «atrás» no vuelva a
 * caer aquí.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
