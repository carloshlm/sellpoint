import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  Shield,
  User,
  Warehouse,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@/lib/auth/hooks";
import { usePermissions } from "@/lib/auth/permissions";
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
  const { has } = usePermissions();
  const [expanded, setExpanded] = React.useState(
    () => window.matchMedia?.("(min-width: 768px)")?.matches ?? true,
  );
  // F1-WEB-USERS cross-cutting: "Sistema" es visible en modo SOLO LECTURA con
  // users:read O roles:read (decisión #327) — los controles de mutación
  // dentro de cada página se gatean por separado con `:manage`.
  const canSeeUsersNav = has("users:read");
  const canSeeRolesNav = has("roles:read");
  const canSeeSystemNav = canSeeUsersNav || canSeeRolesNav;

  // F2: mismo criterio que "Sistema" — el grupo se ve con cualquier `:read`
  // del dominio, y cada link se gatea por SU permiso.
  const canSeeProductsNav = has("products:read");
  const canSeeListsNav = has("catalogs:read");
  const canSeeSchemaNav = has("catalogs:manage");
  const canSeeCatalogNav = canSeeProductsNav || canSeeListsNav || canSeeSchemaNav;
  const canSeeWarehousesNav = has("warehouses:read");
  // F3-NAV-02: los cinco listados de movimientos se ven con `inventory:read`.
  // El botón de CREAR, que exige `inventory:movement`, vive dentro de cada
  // pantalla: quien audita tiene que poder mirar sin poder mover.
  const canSeeInventoryNav = has("inventory:read");

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
          {canSeeCatalogNav && (
            <fieldset
              aria-label={t("catalogs.nav.group")}
              className="m-0 flex flex-col gap-1 border-0 p-0"
            >
              {expanded && (
                <span
                  aria-hidden="true"
                  className="px-3 pt-2 text-xs font-semibold text-muted-foreground uppercase"
                >
                  {t("catalogs.nav.group")}
                </span>
              )}
              {canSeeProductsNav && (
                <Link
                  to="/catalog/products"
                  aria-label={t("catalogs.nav.products")}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                >
                  <Package className="size-4 shrink-0" aria-hidden="true" />
                  {expanded && <span className="truncate">{t("catalogs.nav.products")}</span>}
                </Link>
              )}
              {canSeeListsNav && (
                <Link
                  to="/catalog/lists"
                  aria-label={t("catalogs.nav.lists")}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                >
                  <Package className="size-4 shrink-0" aria-hidden="true" />
                  {expanded && <span className="truncate">{t("catalogs.nav.lists")}</span>}
                </Link>
              )}
              {canSeeSchemaNav && (
                <Link
                  to="/catalog/schema"
                  aria-label={t("catalogs.nav.schema")}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                >
                  <Settings className="size-4 shrink-0" aria-hidden="true" />
                  {expanded && <span className="truncate">{t("catalogs.nav.schema")}</span>}
                </Link>
              )}
            </fieldset>
          )}

          {canSeeWarehousesNav && (
            <fieldset
              aria-label={t("warehouses.nav.group")}
              className="m-0 flex flex-col gap-1 border-0 p-0"
            >
              <Link
                to="/warehouses"
                aria-label={t("warehouses.nav.group")}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
              >
                <Warehouse className="size-4 shrink-0" aria-hidden="true" />
                {expanded && <span className="truncate">{t("warehouses.nav.group")}</span>}
              </Link>
            </fieldset>
          )}

          {canSeeInventoryNav && (
            <fieldset
              aria-label={t("inventory.nav.group")}
              className="m-0 flex flex-col gap-1 border-0 p-0"
            >
              {expanded && (
                <span
                  aria-hidden="true"
                  className="px-3 pt-2 text-xs font-semibold text-muted-foreground uppercase"
                >
                  {t("inventory.nav.group")}
                </span>
              )}
              {(
                [
                  ["/movements/entries", "inventory.nav.entries", ArrowDownToLine],
                  ["/movements/exits", "inventory.nav.exits", ArrowUpFromLine],
                  ["/movements/transfers", "inventory.nav.transfers", ArrowLeftRight],
                  ["/movements/counts", "inventory.nav.counts", ClipboardList],
                  ["/movements/expiring", "inventory.nav.expiring", CalendarClock],
                ] as const
              ).map(([to, label, Icon]) => (
                <Link
                  key={to}
                  to={to}
                  aria-label={t(label)}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {expanded && <span className="truncate">{t(label)}</span>}
                </Link>
              ))}
            </fieldset>
          )}

          {canSeeSystemNav && (
            <fieldset
              aria-label={t("common.layout.nav.system")}
              className="m-0 flex flex-col gap-1 border-0 p-0"
            >
              {expanded && (
                <span
                  aria-hidden="true"
                  className="px-3 pt-2 text-xs font-semibold text-muted-foreground uppercase"
                >
                  {t("common.layout.nav.system")}
                </span>
              )}
              {/* F1-WEB-USERS-05: cada link se gatea por SU PROPIO :read — un
                  actor con roles:read pero sin users:read (o viceversa) solo
                  ve el link de la página a la que en verdad puede entrar. */}
              {canSeeUsersNav && (
                <Link
                  to="/system/users"
                  aria-label={t("users.page.title")}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                >
                  <Settings className="size-4 shrink-0" aria-hidden="true" />
                  {expanded && <span className="truncate">{t("users.page.title")}</span>}
                </Link>
              )}
              {canSeeRolesNav && (
                <Link
                  to="/system/roles"
                  aria-label={t("users.roles.page.title")}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                >
                  <Shield className="size-4 shrink-0" aria-hidden="true" />
                  {expanded && <span className="truncate">{t("users.roles.page.title")}</span>}
                </Link>
              )}
            </fieldset>
          )}
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
