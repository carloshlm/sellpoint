import { Link, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Menu, User } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@/lib/auth/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-AUTH-09: shell autenticado — sidebar colapsable + header con menú de
 * usuario. Reemplaza al nav placeholder de F0. SOLO tokens de marca
 * (`--sidebar*`, bg-card, border-border...): el theming por tenant repinta
 * todo sin tocar este componente.
 *
 * Un solo estado `expanded` con doble lectura responsive:
 * - Desktop (md+): expandido = rail ancho con labels; colapsado = rail de íconos.
 * - Móvil: expandido = drawer superpuesto con backdrop; colapsado = oculto.
 * El valor inicial sigue el viewport (matchMedia); en jsdom (sin matchMedia)
 * cae a expandido.
 */
function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(
    () => window.matchMedia?.("(min-width: 768px)")?.matches ?? true,
  );

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {expanded && (
        <button
          type="button"
          aria-label={t("common.layout.sidebarClose")}
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-40 bg-foreground/40 md:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        className={
          expanded
            ? "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:static"
            : "hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:w-16 md:flex-col"
        }
      >
        <div className="flex h-14 shrink-0 items-center justify-center border-b border-sidebar-border px-4 md:justify-start">
          <span className="truncate text-lg font-semibold">{expanded ? "SellPoint" : "SP"}</span>
        </div>
        <nav aria-label={t("common.layout.navLabel")} className="flex flex-col gap-1 p-2">
          <Link
            to="/dashboard"
            aria-label={t("common.layout.nav.dashboard")}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
          >
            <LayoutDashboard className="size-4 shrink-0" aria-hidden="true" />
            {expanded && <span className="truncate">{t("common.layout.nav.dashboard")}</span>}
          </Link>
          <Link
            to="/profile"
            aria-label={t("common.layout.nav.profile")}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
          >
            <User className="size-4 shrink-0" aria-hidden="true" />
            {expanded && <span className="truncate">{t("common.layout.nav.profile")}</span>}
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4">
          <button
            type="button"
            aria-label={t("common.layout.sidebarToggle")}
            aria-expanded={expanded}
            aria-controls="app-sidebar"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-md p-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <UserMenu />
        </header>
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}

/**
 * F1-WEB-AUTH-11 (container): el menú del header con el logout. Revoca la
 * familia en el backend, pero pase lo que pase (`onSettled`) limpia la sesión
 * local y navega a /login — con la red caída no podemos revocar, pero jamás
 * dejamos al usuario "atrapado" logueado en el cliente.
 */
function UserMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const navigate = useNavigate();
  const logoutMutation = useLogout();

  const handleLogout = () => {
    setOpen(false);
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        clearAuth();
        navigate({ to: "/login" });
      },
    });
  };

  // Fallback si el user aún no llegó (bootstrap a medias): label genérico.
  const displayName = user?.firstName ?? user?.email ?? t("common.layout.userMenu.label");

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-48 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="truncate">{displayName}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("common.layout.userMenu.label")}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {user && (
            <p className="truncate border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
              {user.email}
            </p>
          )}
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <User className="size-4" aria-hidden="true" />
            {t("common.layout.userMenu.profile")}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t("common.layout.userMenu.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

export { AppLayout };
