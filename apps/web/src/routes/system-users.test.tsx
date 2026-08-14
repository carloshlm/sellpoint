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
}));

// F1-WEB-USERS-04 (WU5): "Restablecer contraseña" reusa el endpoint público
// `POST /auth/forgot-password` (D del proposal) — mock PARCIAL, el resto del
// módulo (login, logout, etc.) sigue real porque `ProtectedRoute`/`AppLayout`
// lo necesitan intacto para montar la sesión ya seteada por `setAuth`.
vi.mock("../lib/auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/api")>();
  return { ...actual, forgotPassword: vi.fn() };
});

const mockedApi = vi.mocked(rbacApi);
const mockedForgotPassword = vi.mocked(authApi.forgotPassword);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es",
  permissions,
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

async function renderRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
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

    expect(await screen.findByText("No tenés permiso para ver esta sección.")).toBeInTheDocument();
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

  it("con users:manage la tabla reserva la columna de acciones (WU5 la llena)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read", "users:manage"]));
    await renderRoute("/system/users");

    expect(await screen.findByText("Ana García")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
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
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "sales:read"]));
      const newUser: rbacApi.UserDetail = {
        id: "u3",
        email: "nueva@acme.mx",
        firstName: "Nueva",
        lastNamePaternal: "Persona",
        lastNameMaternal: null,
        status: "invited",
        locale: "es",
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
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "sales:read"]));
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
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "sales:read"]));
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
    });

    it("con users:manage: un rol con permisos que el actor no posee aparece deshabilitado en el checklist (D8)", async () => {
      const user = userEvent.setup();
      useAuthStore
        .getState()
        .setAuth("jwt-demo", demoUser(["users:read", "users:manage", "sales:read"]));

      await renderRoute("/system/users");
      await screen.findByText("Ana García");
      await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));

      expect(await screen.findByRole("checkbox", { name: "Cajero" })).toBeEnabled();
      expect(screen.getByRole("checkbox", { name: "Admin" })).toBeDisabled();
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
          "Si el email existe, va a recibir instrucciones para restablecer la contraseña.",
        ),
      ).toBeInTheDocument();
    });
  });
});
