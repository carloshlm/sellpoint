import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SandboxBanner } from "@/components/layout/sandbox-banner";
import { useSessionBootstrap } from "@/lib/auth/session-bootstrap";

export const Route = createRootRoute({
  component: RootLayout,
});

/**
 * Root SIN chrome propio: el nav placeholder de F0 murió con F1-WEB-AUTH-09.
 * Las vistas autenticadas traen su AppLayout; las de auth, su AuthCard.
 * El bootstrap de sesión arranca acá para que un reload en CUALQUIER ruta
 * reviva la cookie de refresh antes de que ProtectedRoute decida.
 */
function RootLayout() {
  useSessionBootstrap();

  return (
    <>
      {/* En el ROOT y no en AppLayout: el aviso de sandbox debe verse
          también en /login — es donde más duele confundirse de ambiente. */}
      <SandboxBanner />
      <Outlet />
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-right" />}
    </>
  );
}
