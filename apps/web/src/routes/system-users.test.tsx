import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import * as authApi from "../lib/auth/api";
import { createQueryClient } from "../lib/query-client";
import * as rbacApi from "../lib/rbac/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

/**
 * F1-WEB-USERS-01 (criterio "Verificar" del tablero: "lista de usuarios del
 * tenant visible") — mismo arnés que `auth-flows.test.tsx`: routeTree REAL,
 * `createQueryClient()` (nunca `new QueryClient()` — C1 de f1-web-auth), API
 * mockeada.
 */
vi.mock("../lib/rbac/api", () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  suspendUser: vi.fn(),
  reactivateUser: vi.fn(),
  resendInvitation: vi.fn(),
  listRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  listPermissions: vi.fn(),
  getWarehouseScope: vi.fn(),
  replaceWarehouseScope: vi.fn(),
}));

vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
}));

// F1-WEB-USERS-04 (WU5): "Restablecer contraseña" reusa el endpoint público
// `POST /auth/forgot-password` (D del proposal) — mock PARCIAL, el resto del
// módulo (login, logout, etc.) sigue real porque `ProtectedRoute`/`AppLayout`
// lo necesitan intacto para montar la sesión ya seteada por `setAuth`.
//
// F1-WEB-USERS-05 (WU6, D3): editar el PROPIO usuario ahora dispara
// `resyncSession()` (`useUpdateUser`, `lib/rbac/hooks.ts`) → `getMe()` real.
// Se mockea también acá para no disparar una request de red de verdad.
vi.mock("../lib/auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/api")>();
  return { ...actual, forgotPassword: vi.fn(), getMe: vi.fn() };
});

const mockedApi = vi.mocked(rbacApi);
const mockedWarehouses = vi.mocked(warehousesApi);
const mockedForgotPassword = vi.mocked(authApi.forgotPassword);
const mockedGetMe = vi.mocked(authApi.getMe);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es",
  permissions,
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    // Tests de F1-WEB-USERS: fuera del alcance de onboarding — el tenant ya
    // está onboarded para que OnboardingGate nunca intercepte estas rutas.
    onboarded: true,
  },
});

const USERS: rbacApi.UserDetail[] = [
  {
    id: "u1",
    email: "ana@acme.mx",
    firstName: "Ana",
    lastNamePaternal: "García",
    lastNameMaternal: null,
    status: "active",
    locale: "es",
    defaultWarehouseId: null,
    roles: [{ id: "r1", name: "Cajero" }],
  },
  {
    id: "u2",
    email: "beto@acme.mx",
    firstName: "Beto",
    lastNamePaternal: "López",
    lastNameMaternal: null,
    status: "invited",
    locale: "es",
    defaultWarehouseId: null,
    roles: [{ id: "r2", name: "Admin" }],
  },
  {
    id: "u3",
    email: "carla@acme.mx",
    firstName: "Carla",
    lastNamePaternal: "Ruiz",
    lastNameMaternal: null,
    status: "active",
    locale: "es",
    defaultWarehouseId: null,
    roles: [{ id: "r1", name: "Cajero" }],
  },
  {
    id: "u4",
    email: "dana@acme.mx",
    firstName: "Dana",
    lastNamePaternal: "Soto",
    lastNameMaternal: null,
    status: "suspended",
    locale: "es",
    defaultWarehouseId: null,
    roles: [{ id: "r1", name: "Cajero" }],
  },
];

// Batch 2 (F1-WEB-USERS-02/03): roles usados por el checklist de D8. "Admin"
// exige `roles:manage` a propósito — ningún actor de estos tests lo tiene,
// así que ejercita el `disabled` de escalada sin inventar un tercer rol.
const ROLES: rbacApi.RoleSummary[] = [
  { id: "r1", name: "Cajero", permissionCodes: ["sales:read"], userCount: 2 },
  { id: "r2", name: "Admin", permissionCodes: ["users:manage", "roles:manage"], userCount: 1 },
];

// F3-NAV-03: los almacenes del checklist de alcance.
const ALMACENES: warehousesApi.Warehouse[] = [
  { id: "w1", name: "Central", address: null, isActive: true, deactivationBlockedBy: null },
  { id: "w2", name: "Bodega Norte", address: null, isActive: true, deactivationBlockedBy: null },
];

// W2 (verify-report #341): `lng` opcional — instancia hermética de i18n
// (mismo patrón que `router.test.tsx`), sin depender de navigator.language.
async function renderRoute(path: string, lng?: "es" | "en") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const i18n = createI18n();
  if (lng) {
    await i18n.changeLanguage(lng);
  }
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

describe("/system/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listUsers.mockResolvedValue(USERS);
    mockedApi.listRoles.mockResolvedValue(ROLES);
    mockedGetMe.mockResolvedValue(
      demoUser(["users:read", "users:manage", "roles:read", "sales:read"]),
    );
    mockedWarehouses.listWarehouses.mockResolvedValue(ALMACENES);
    mockedApi.getWarehouseScope.mockResolvedValue([]);
    mockedApi.replaceWarehouseScope.mockResolvedValue([]);
  });

  it("sin users:read ni roles:read, el nav NO lista 'Sistema'", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["products:read"]));
    await renderRoute("/dashboard");

    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sistema")).not.toBeInTheDocument();
  });

  it("sin users:read, visitar /system/users muestra el gate 'sin permiso' y NO la tabla", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["products:read"]));
    await renderRoute("/system/users");

    expect(await screen.findByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(mockedApi.listUsers).not.toHaveBeenCalled();
  });

  it("con users:read (sin manage): la lista del tenant es visible, sin columna de acciones", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read"]));
    await renderRoute("/system/users");

    expect(await screen.findByText("Ana García")).toBeInTheDocument();
    expect(screen.getByText("Beto López")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
  });

  it("con users:read Y roles:read, el nav SÍ lista 'Sistema'", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["roles:read"]));
    await renderRoute("/dashboard");

    await waitFor(() => expect(screen.getByLabelText("Sistema")).toBeInTheDocument());
  });

  // Micro-tarea de cierre F1-WEB-USERS: dentro de "Sistema" cada link se
  // gatea por SU PROPIO :read — antes solo existía un link a /system/users
  // y /system/roles quedaba sin forma de navegar hacia él desde la UI.
  it("con users:read (sin roles:read): el nav lista 'Usuarios' pero NO 'Roles'", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read"]));
    await renderRoute("/dashboard");

    const usersLink = await screen.findByRole("link", { name: "Usuarios" });
    expect(usersLink).toHaveAttribute("href", "/system/users");
    expect(screen.queryByRole("link", { name: "Roles" })).not.toBeInTheDocument();
  });

  it("con roles:read (sin users:read): el nav lista 'Roles' pero NO 'Usuarios', y navega a /system/roles", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["roles:read"]));
    await renderRoute("/dashboard");

    expect(screen.queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
    const rolesLink = await screen.findByRole("link", { name: "Roles" });
    expect(rolesLink).toHaveAttribute("href", "/system/roles");

    await user.click(rolesLink);

    expect(await screen.findByTestId("system-roles-title")).toBeInTheDocument();
  });

  it("con users:manage la tabla reserva la columna de acciones (WU5 la llena)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
    await renderRoute("/system/users");

    expect(await screen.findByText("Ana García")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
  });

  // W2 (verify-report #341): el escenario "Cambio de idioma" del spec
  // ("WHEN visita /system/users THEN todos los textos se muestran en
  // inglés") no tenía NINGÚN test — nada guardaba la regresión si se
  // agregaba una clave solo a es/users.json.
  it("con lng: 'en': el título, las columnas y las acciones se muestran en inglés", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
    await renderRoute("/system/users", "en");

    expect(await screen.findByTestId("system-users-title")).toHaveTextContent("Users");
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New user" })).toBeInTheDocument();
    expect(screen.getByText("Ana García")).toBeInTheDocument();
  });

  // F1-WEB-USERS-02/03 (Batch 2): alta y edición de usuario.
  describe("alta y edición (F1-WEB-USERS-02/03)", () => {
    it("sin users:manage no aparecen los botones 'Nuevo usuario' ni 'Editar'", async () => {
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read"]));
      await renderRoute("/system/users");

      expect(await screen.findByText("Ana García")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    });

    it("con users:manage: alta exitosa llama createUser, refresca la lista sin recargar y muestra la confirmación de invitación", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));
      const newUser: rbacApi.UserDetail = {
        id: "u3",
        email: "nueva@acme.mx",
        firstName: "Nueva",
        lastNamePaternal: "Persona",
        lastNameMaternal: null,
        status: "invited",
        locale: "es",
        defaultWarehouseId: null,
        roles: [{ id: "r1", name: "Cajero" }],
      };
      mockedApi.listUsers.mockResolvedValueOnce(USERS).mockResolvedValueOnce([...USERS, newUser]);
      mockedApi.createUser.mockResolvedValue(newUser);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");

      await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));
      await user.type(screen.getByLabelText("Email"), "nueva@acme.mx");
      await user.type(screen.getByLabelText("Nombre"), "Nueva");
      await user.type(screen.getByLabelText("Apellido paterno"), "Persona");
      await user.click(screen.getByRole("checkbox", { name: "Cajero" }));
      await user.click(screen.getByRole("button", { name: "Crear usuario" }));

      await waitFor(() =>
        expect(mockedApi.createUser).toHaveBeenCalledWith(
          {
            email: "nueva@acme.mx",
            firstName: "Nueva",
            lastNamePaternal: "Persona",
            locale: "es",
            roleIds: ["r1"],
          },
          expect.anything(),
        ),
      );
      // La invitación la manda el backend solo (F1-INVITE ya cerrado); la UI
      // solo lo comunica, no dispara ningún request extra.
      expect(await screen.findByText(/Se invitó a nueva@acme\.mx/)).toBeInTheDocument();
      expect(await screen.findByText("Nueva Persona")).toBeInTheDocument();
    });

    it("con users:manage: email duplicado (409 users.email_taken) muestra error inline en el campo email y el formulario sigue abierto", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));
      mockedApi.createUser.mockRejectedValue({
        statusCode: 409,
        message: "Ese correo ya está en uso.",
        error: "Conflict",
        code: "users.email_taken",
      });

      await renderRoute("/system/users");
      await screen.findByText("Ana García");

      await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));
      await user.type(screen.getByLabelText("Email"), "ana@acme.mx");
      await user.type(screen.getByLabelText("Nombre"), "Otra");
      await user.type(screen.getByLabelText("Apellido paterno"), "Persona");
      await user.click(screen.getByRole("checkbox", { name: "Cajero" }));
      await user.click(screen.getByRole("button", { name: "Crear usuario" }));

      expect(await screen.findByText("Ese correo ya está en uso.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Crear usuario" })).toBeInTheDocument();
    });

    it("con users:manage: editar un usuario llama updateUser sin email y la fila refleja los cambios", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));
      const [ana, beto] = USERS;
      if (!ana || !beto) throw new Error("fixture USERS debe tener 2 elementos");
      const updatedAna: rbacApi.UserDetail = { ...ana, lastNamePaternal: "García Nueva" };
      mockedApi.listUsers.mockResolvedValueOnce(USERS).mockResolvedValueOnce([updatedAna, beto]);
      mockedApi.updateUser.mockResolvedValue(updatedAna);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");

      const rows = screen.getAllByRole("row");
      await user.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Editar" }));

      const lastNameInput = await screen.findByLabelText("Apellido paterno");
      expect(lastNameInput).toHaveValue("García");
      await user.clear(lastNameInput);
      await user.type(lastNameInput, "García Nueva");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() =>
        expect(mockedApi.updateUser).toHaveBeenCalledWith("u1", {
          firstName: "Ana",
          lastNamePaternal: "García Nueva",
          locale: "es",
          roleIds: ["r1"],
        }),
      );
      expect(await screen.findByText("Ana García Nueva")).toBeInTheDocument();
      // W3 (verify-report #341): editar un usuario no daba NINGÚN feedback de
      // éxito, a diferencia de la alta ("Se invitó a...") y del guardado de
      // permisos (`roles.editor.saveSuccess`) — clave `users.form.editSuccess`
      // existía en es/en pero con 0 usos en código.
      expect(await screen.findByText("Los cambios se guardaron.")).toBeInTheDocument();
    });

    // C1 (verify-report #341): editar Ana y, SIN cerrar el form, editar Beto
    // — el form debe re-inicializarse con los datos de Beto (no seguir
    // mostrando los de Ana) y el PATCH debe llevar los datos y roleIds de
    // Beto, nunca los de Ana.
    it("con users:manage: editar Ana y luego Beto SIN cerrar el form muestra los datos de Beto y el PATCH lleva los datos de Beto (C1)", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));
      const [, beto] = USERS;
      if (!beto) throw new Error("fixture USERS debe tener al menos 2 elementos");
      const updatedBeto: rbacApi.UserDetail = { ...beto, lastNamePaternal: "López Nuevo" };
      mockedApi.updateUser.mockResolvedValue(updatedBeto);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");

      const rows = screen.getAllByRole("row");
      await user.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Editar" }));
      expect(await screen.findByLabelText("Nombre")).toHaveValue("Ana");

      // SIN cerrar el form: abrir "Editar" en la fila de Beto (u2).
      await user.click(within(rows[2] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Editar" }));

      const firstNameInput = await screen.findByLabelText("Nombre");
      await waitFor(() => expect(firstNameInput).toHaveValue("Beto"));
      expect(screen.getByLabelText("Apellido paterno")).toHaveValue("López");

      await user.clear(screen.getByLabelText("Apellido paterno"));
      await user.type(screen.getByLabelText("Apellido paterno"), "López Nuevo");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() =>
        expect(mockedApi.updateUser).toHaveBeenCalledWith("u2", {
          firstName: "Beto",
          lastNamePaternal: "López Nuevo",
          locale: "es",
          roleIds: ["r2"],
        }),
      );
    });

    // F1-WEB-USERS-05 (WU6, D3): gap dejado abierto en el batch 2 — editar el
    // PROPIO usuario (no solo el propio ROL desde /system/roles) también debe
    // re-sincronizar la sesión, porque `roleIds` viaja en `PATCH /users/:id`.
    it("con users:manage: editar el PROPIO usuario dispara resync de sesión — el store queda con los permisos frescos de getMe", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));
      const [ana, beto] = USERS;
      if (!ana || !beto) throw new Error("fixture USERS debe tener 2 elementos");
      const updatedAna: rbacApi.UserDetail = { ...ana, lastNamePaternal: "García Nueva" };
      mockedApi.listUsers.mockResolvedValueOnce(USERS).mockResolvedValueOnce([updatedAna, beto]);
      mockedApi.updateUser.mockResolvedValue(updatedAna);
      mockedGetMe.mockResolvedValue(demoUser(["users:read", "users:manage", "roles:manage"]));

      await renderRoute("/system/users");
      await screen.findByText("Ana García");

      const rows = screen.getAllByRole("row");
      await user.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Editar" }));
      const lastNameInput = await screen.findByLabelText("Apellido paterno");
      await user.clear(lastNameInput);
      await user.type(lastNameInput, "García Nueva");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => expect(mockedApi.updateUser).toHaveBeenCalled());
      await waitFor(() => expect(mockedGetMe).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(useAuthStore.getState().user?.permissions).toEqual([
          "users:read",
          "users:manage",
          "roles:manage",
        ]),
      );
    });

    it("con users:manage: un rol con permisos que el actor no posee aparece deshabilitado en el checklist (D8)", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));

      expect(await screen.findByRole("checkbox", { name: "Cajero" })).toBeEnabled();
      expect(screen.getByRole("checkbox", { name: "Admin" })).toBeDisabled();
    });

    // Fix del desvío del batch 2 (documentado en apply-progress): el disabled
    // era SIMÉTRICO — no dejaba QUITARLE a otro un rol que el actor no posee,
    // aunque `assertNoRoleAssignmentEscalation` solo valida el delta AGREGADO
    // (misma asimetría que D5). Beto (u2) ya tiene "Admin" asignado; el actor
    // (Ana) no tiene roles:manage — debe poder desasignárselo igual.
    it("con users:manage: un rol ya asignado que el actor no posee se puede QUITAR aunque no se pueda agregar (fix de asimetría D8)", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));
      const [, beto] = USERS;
      if (!beto) throw new Error("fixture USERS debe tener al menos 2 elementos");
      // Beto con AMBOS roles: quitarle "Admin" (escalado, no poseído por el
      // actor) no debe dejarlo sin roles — `roleIds.min(1)` bloquearía el
      // submit por una razón ajena a lo que este test verifica.
      const betoConAmbosRoles: rbacApi.UserDetail = {
        ...beto,
        roles: [
          { id: "r1", name: "Cajero" },
          { id: "r2", name: "Admin" },
        ],
      };
      const betoSinAdmin: rbacApi.UserDetail = { ...beto, roles: [{ id: "r1", name: "Cajero" }] };
      mockedApi.listUsers.mockResolvedValueOnce([
        USERS[0] as rbacApi.UserDetail,
        betoConAmbosRoles,
        ...USERS.slice(2),
      ]);
      mockedApi.updateUser.mockResolvedValue(betoSinAdmin);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      await user.click(within(rows[2] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Editar" }));

      const adminCheckbox = await screen.findByRole("checkbox", { name: "Admin" });
      expect(adminCheckbox).toBeChecked();
      expect(adminCheckbox).toBeEnabled();
      await user.click(adminCheckbox);
      expect(adminCheckbox).not.toBeChecked();

      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() =>
        expect(mockedApi.updateUser).toHaveBeenCalledWith("u2", {
          firstName: "Beto",
          lastNamePaternal: "López",
          locale: "es",
          roleIds: ["r1"],
        }),
      );
    });

    // W1 (verify-report #341): `users:manage` sin `roles:read` hoy dispara
    // GET /roles igual y pega un 403 silencioso — 0 checkboxes, alta
    // imposible sin ningún mensaje. El fix debe: (a) NO llamar listRoles sin
    // roles:read, y (b) decirlo en el form en vez de mostrar un checklist
    // vacío que bloquea el submit para siempre.
    it("con users:manage pero SIN roles:read: no pide el catálogo de roles y el form explica por qué no hay checklist", async () => {
      const user = userEvent.setup();
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));

      expect(mockedApi.listRoles).not.toHaveBeenCalled();
      expect(
        await screen.findByText("Hace falta el permiso roles:read para poder asignar roles."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });
  });

  // F1-WEB-USERS-04 (Batch 3, WU5): menú ⋮ de acciones por fila.
  describe("acciones de fila (F1-WEB-USERS-04)", () => {
    it("el menú de la propia fila (Ana) no ofrece 'Suspender' ni 'Reenviar invitación'", async () => {
      const user = userEvent.setup();
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      await user.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Acciones" }));

      expect(await screen.findByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Suspender" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: "Reenviar invitación" }),
      ).not.toBeInTheDocument();
    });

    it("el menú de un usuario 'active' distinto del actor NO ofrece 'Reenviar invitación'", async () => {
      const user = userEvent.setup();
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      // fila 3 = Carla (u3, active, no es el actor)
      await user.click(within(rows[3] as HTMLElement).getByRole("button", { name: "Acciones" }));

      expect(await screen.findByRole("menuitem", { name: "Suspender" })).toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: "Reenviar invitación" }),
      ).not.toBeInTheDocument();
    });

    it("suspender (con confirmación): llama suspendUser y la fila refresca con el estado nuevo", async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
      const [ana, beto, carla, dana] = USERS;
      if (!ana || !beto || !carla || !dana) throw new Error("fixture USERS incompleta");
      const suspendedCarla: rbacApi.UserDetail = { ...carla, status: "suspended" };
      mockedApi.listUsers
        .mockResolvedValueOnce(USERS)
        .mockResolvedValueOnce([ana, beto, suspendedCarla, dana]);
      mockedApi.suspendUser.mockResolvedValue(suspendedCarla);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      await user.click(within(rows[3] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Suspender" }));

      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() =>
        expect(mockedApi.suspendUser).toHaveBeenCalledWith("u3", expect.anything()),
      );
      expect(await screen.findByText("Carla Ruiz quedó suspendido.")).toBeInTheDocument();
      await waitFor(() =>
        expect(
          within(screen.getAllByRole("row")[3] as HTMLElement).getByText("Suspendido"),
        ).toBeInTheDocument(),
      );
      confirmSpy.mockRestore();
    });

    it("suspender: cancelar la confirmación NO llama suspendUser", async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      await user.click(within(rows[3] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Suspender" }));

      expect(confirmSpy).toHaveBeenCalled();
      expect(mockedApi.suspendUser).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("reactivar: llama reactivateUser (sin confirmación) y la fila refresca con el estado nuevo", async () => {
      const user = userEvent.setup();
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
      const [ana, beto, carla, dana] = USERS;
      if (!ana || !beto || !carla || !dana) throw new Error("fixture USERS incompleta");
      const reactivatedDana: rbacApi.UserDetail = { ...dana, status: "active" };
      mockedApi.listUsers
        .mockResolvedValueOnce(USERS)
        .mockResolvedValueOnce([ana, beto, carla, reactivatedDana]);
      mockedApi.reactivateUser.mockResolvedValue(reactivatedDana);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      await user.click(within(rows[4] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Reactivar" }));

      await waitFor(() =>
        expect(mockedApi.reactivateUser).toHaveBeenCalledWith("u4", expect.anything()),
      );
      expect(await screen.findByText("Dana Soto quedó activo de nuevo.")).toBeInTheDocument();
      await waitFor(() =>
        expect(
          within(screen.getAllByRole("row")[4] as HTMLElement).getByText("Activo"),
        ).toBeInTheDocument(),
      );
    });

    it("reenviar invitación: llama resendInvitation (sin confirmación) y muestra el feedback", async () => {
      const user = userEvent.setup();
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
      const [, beto] = USERS;
      if (!beto) throw new Error("fixture USERS incompleta");
      mockedApi.resendInvitation.mockResolvedValue(beto);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      await user.click(within(rows[2] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Reenviar invitación" }));

      await waitFor(() =>
        expect(mockedApi.resendInvitation).toHaveBeenCalledWith("u2", expect.anything()),
      );
      expect(await screen.findByText("Se reenvió la invitación a Beto López.")).toBeInTheDocument();
    });

    it("reenviar invitación: el 409 users.not_invited se muestra como error sin romper la tabla", async () => {
      const user = userEvent.setup();
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
      mockedApi.resendInvitation.mockRejectedValue({
        statusCode: 409,
        message: "Este usuario ya no está invitado.",
        error: "Conflict",
        code: "users.not_invited",
      });

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      await user.click(within(rows[2] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Reenviar invitación" }));

      expect(await screen.findByText("Este usuario ya no está invitado.")).toBeInTheDocument();
      expect(await screen.findByText("Ana García")).toBeInTheDocument();
    });

    it("restablecer contraseña: llama forgotPassword con el email del usuario y muestra el copy anti-enumeración", async () => {
      const user = userEvent.setup();
      useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
      mockedForgotPassword.mockResolvedValue(undefined);

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      const rows = screen.getAllByRole("row");
      // fila 3 = Carla (u3, active)
      await user.click(within(rows[3] as HTMLElement).getByRole("button", { name: "Acciones" }));
      await user.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));

      await waitFor(() =>
        expect(mockedForgotPassword).toHaveBeenCalledWith("carla@acme.mx", expect.anything()),
      );
      expect(
        await screen.findByText(
          "Si el correo existe, va a recibir instrucciones para restablecer la contraseña.",
        ),
      ).toBeInTheDocument();
    });
  });

  /**
   * F3-NAV-03 (CU-SYS-04) — deuda de F2-SCOPE-03: el API existe desde F2 y
   * la cara nunca se construyó, así que "el Encargado solo ve su almacén" no
   * se podía configurar desde la app.
   *
   * Los estados salen de DATOS (permisos de los roles marcados, filas del
   * scope), nunca del nombre del rol ni de una cadena de copy.
   */
  /** Abre "Editar" en la fila que contiene ese nombre. Compartido por los dos
   * bloques que editan un usuario (F3-HOME-02 y F3-NAV-03). */
  async function abrirEdicionDe(user: ReturnType<typeof userEvent.setup>, nombre: string) {
    if (!useAuthStore.getState().user) {
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read"]));
    }
    await renderRoute("/system/users");
    await screen.findByText(nombre);
    const fila = screen.getByText(nombre).closest("tr") as HTMLElement;
    await user.click(within(fila).getByRole("button", { name: "Acciones" }));
    await user.click(await screen.findByRole("menuitem", { name: "Editar" }));
  }

  /**
   * F3-HOME-02 — el almacén ASIGNADO, distinto del alcance.
   *
   * Alcance = dónde PUEDE operar (una lista, vacío = todos).
   * Asignado = desde dónde opera POR DEFECTO (uno solo). El POS de F4 no puede
   * vender desde una lista: necesita un almacén concreto.
   */
  describe("Almacén asignado en el form de usuario (F3-HOME-02)", () => {
    it("viaja en el ALTA, a diferencia del alcance", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "roles:read", "sales:read"]));
      mockedApi.createUser.mockResolvedValue(USERS[0] as rbacApi.UserDetail);
      await renderRoute("/system/users");
      await screen.findByText("Ana García");

      await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));
      await user.type(screen.getByLabelText("Email"), "nuevo@acme.mx");
      await user.type(screen.getByLabelText("Nombre"), "Nuevo");
      await user.type(screen.getByLabelText("Apellido paterno"), "Usuario");
      await user.click(screen.getByRole("checkbox", { name: "Cajero" }));
      await user.selectOptions(screen.getByLabelText("Almacén asignado"), "w2");
      await user.click(screen.getByRole("button", { name: "Crear usuario" }));

      // Es una COLUMNA, no otro recurso: entra en el mismo POST y no hay
      // escritura parcial posible.
      await waitFor(() =>
        expect(mockedApi.createUser).toHaveBeenCalledWith(
          expect.objectContaining({ defaultWarehouseId: "w2" }),
          // React Query pasa su contexto como 2º argumento cuando el
          // `mutationFn` es la función del api directamente.
          expect.anything(),
        ),
      );
    });

    it("«Sin asignar» es una opción válida y explica qué implica", async () => {
      const user = userEvent.setup();
      await abrirEdicionDe(user, "Ana García");

      const select = await screen.findByLabelText("Almacén asignado");
      expect(
        within(select as HTMLElement).getByRole("option", { name: "Sin asignar" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("default-warehouse-hint")).toBeInTheDocument();
    });

    it("editar manda el asignado en el PATCH", async () => {
      const user = userEvent.setup();
      mockedApi.updateUser.mockResolvedValue(USERS[0] as rbacApi.UserDetail);
      await abrirEdicionDe(user, "Ana García");

      await user.selectOptions(await screen.findByLabelText("Almacén asignado"), "w1");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() =>
        expect(mockedApi.updateUser).toHaveBeenCalledWith(
          "u1",
          expect.objectContaining({ defaultWarehouseId: "w1" }),
        ),
      );
    });

    /**
     * La regla que cose las dos cosas: con alcance marcado, un almacén fuera de
     * él no se puede asignar — el API lo rechaza con 409 y la UI no debería
     * dejar llegar hasta ahí.
     */
    it("con alcance marcado, los almacenes fuera de él no se pueden asignar", async () => {
      const user = userEvent.setup();
      mockedApi.getWarehouseScope.mockResolvedValue(["w1"]);
      await abrirEdicionDe(user, "Ana García");

      const select = (await screen.findByLabelText("Almacén asignado")) as HTMLSelectElement;
      const fuera = within(select).getByRole("option", {
        name: "Bodega Norte",
      }) as HTMLOptionElement;
      expect(fuera.disabled).toBe(true);
      expect(
        (within(select).getByRole("option", { name: "Central" }) as HTMLOptionElement).disabled,
      ).toBe(false);
    });
  });

  describe("Alcance por almacén en el form de usuario (F3-NAV-03)", () => {
    it("lista un checkbox por almacén, marcando los que el usuario ya tiene", async () => {
      const user = userEvent.setup();
      mockedApi.getWarehouseScope.mockResolvedValue(["w2"]);

      await abrirEdicionDe(user, "Ana García");

      expect(await screen.findByTestId("warehouse-scope-w1")).not.toBeChecked();
      expect(screen.getByTestId("warehouse-scope-w2")).toBeChecked();
      expect(mockedApi.getWarehouseScope).toHaveBeenCalledWith("u1");
    });

    it("guardar manda el REEMPLAZO completo de ids, no un delta", async () => {
      const user = userEvent.setup();
      mockedApi.getWarehouseScope.mockResolvedValue(["w2"]);
      mockedApi.updateUser.mockResolvedValue(USERS[0] as rbacApi.UserDetail);

      await abrirEdicionDe(user, "Ana García");
      await user.click(await screen.findByTestId("warehouse-scope-w1"));
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      // Manda LOS DOS, no solo el agregado: el endpoint reemplaza el set.
      await waitFor(() =>
        expect(mockedApi.replaceWarehouseScope).toHaveBeenCalledWith("u1", ["w2", "w1"]),
      );
    });

    it("sin nada marcado avisa que el usuario ve TODOS (default permisivo)", async () => {
      const user = userEvent.setup();
      mockedApi.getWarehouseScope.mockResolvedValue([]);

      await abrirEdicionDe(user, "Ana García");

      expect(await screen.findByTestId("warehouse-scope-empty-hint")).toBeInTheDocument();
    });

    /**
     * El corazón de la tarea: quien administra el tenant ve todo pase lo que
     * pase, así que la lista sería una promesa falsa. El estado sale de los
     * PERMISOS de los roles marcados (`roles:manage` + `users:manage`, el
     * mismo criterio que `TENANT_ADMIN_PERMISSION_CODES` usa en el API),
     * NUNCA del nombre "Admin".
     */
    it("con un rol que administra el tenant, la lista queda deshabilitada", async () => {
      const user = userEvent.setup();
      mockedApi.getWarehouseScope.mockResolvedValue([]);

      await abrirEdicionDe(user, "Beto López");

      expect(await screen.findByTestId("warehouse-scope-admin-hint")).toBeInTheDocument();
      expect(screen.getByTestId("warehouse-scope-w1")).toBeDisabled();
    });

    it("y al guardar a ese usuario NO se toca su alcance", async () => {
      const user = userEvent.setup();
      mockedApi.getWarehouseScope.mockResolvedValue([]);
      mockedApi.updateUser.mockResolvedValue(USERS[1] as rbacApi.UserDetail);

      await abrirEdicionDe(user, "Beto López");
      await user.click(await screen.findByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => expect(mockedApi.updateUser).toHaveBeenCalled());
      expect(mockedApi.replaceWarehouseScope).not.toHaveBeenCalled();
    });

    /**
     * Derivado de datos y EN VIVO: marcar el rol que da el combo de admin
     * apaga la lista en el acto, sin guardar ni recargar. Si dependiera de
     * `user.roles` (lo que vino del server), la pantalla mentiría hasta el
     * próximo refresh.
     */
    it("marcar el rol de admin apaga la lista en el acto", async () => {
      const user = userEvent.setup();
      // Este actor SÍ tiene roles:manage, así que puede marcar "Admin".
      useAuthStore
        .getState()
        .setAuth(
          "jwt-demo",
          demoUser(["users:read", "users:manage", "roles:read", "roles:manage"]),
        );
      mockedApi.getWarehouseScope.mockResolvedValue(["w1"]);

      await abrirEdicionDe(user, "Ana García");
      expect(await screen.findByTestId("warehouse-scope-w1")).toBeEnabled();

      await user.click(screen.getByLabelText("Admin"));

      expect(await screen.findByTestId("warehouse-scope-admin-hint")).toBeInTheDocument();
      expect(screen.getByTestId("warehouse-scope-w1")).toBeDisabled();
    });
  });
});
