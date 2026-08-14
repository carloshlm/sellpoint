import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
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
 * F1-WEB-USERS-05 (WU6). Mismo arnés que `system-users.test.tsx`: routeTree
 * REAL, `createQueryClient()` (nunca `new QueryClient()`), API mockeada.
 * Criterio "Verificar" del tablero: "modificar permisos persiste, aplica en
 * próxima request del usuario" — el resync (`getMe` tras `PATCH /roles/:id`)
 * es el corazón de este archivo, no un extra.
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

vi.mock("../lib/auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/api")>();
  return { ...actual, getMe: vi.fn() };
});

const mockedApi = vi.mocked(rbacApi);
const mockedGetMe = vi.mocked(authApi.getMe);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es",
  permissions,
});

const ROLES: rbacApi.RoleSummary[] = [
  { id: "r1", name: "Cajero", permissionCodes: ["sales:read"], userCount: 2 },
  { id: "r2", name: "Sin uso", permissionCodes: [], userCount: 0 },
];

const PERMISSION_GROUPS: rbacApi.PermissionGroup[] = [
  {
    module: "sales",
    permissions: [
      { code: "sales:read", description: null },
      { code: "sales:manage", description: null },
    ],
  },
  {
    module: "roles",
    permissions: [{ code: "roles:manage", description: null }],
  },
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

describe("/system/roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listRoles.mockResolvedValue(ROLES);
    mockedApi.listPermissions.mockResolvedValue(PERMISSION_GROUPS);
    mockedGetMe.mockResolvedValue(demoUser(["roles:read", "roles:manage"]));
  });

  it("sin roles:read el gate bloquea la página y no pide roles ni permisos", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["users:read"]));
    await renderRoute("/system/roles");

    expect(await screen.findByText("No tenés permiso para ver esta sección.")).toBeInTheDocument();
    expect(mockedApi.listRoles).not.toHaveBeenCalled();
    expect(mockedApi.listPermissions).not.toHaveBeenCalled();
  });

  it("con roles:read (sin manage): roles y permisos visibles, checklist marcado pero deshabilitado, sin Guardar/Eliminar/Nuevo rol", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["roles:read"]));
    await renderRoute("/system/roles");

    await user.click(await screen.findByRole("button", { name: "Cajero" }));

    const salesReadCheckbox = await screen.findByRole("checkbox", { name: "sales:read" });
    expect(salesReadCheckbox).toBeChecked();
    expect(salesReadCheckbox).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo rol" })).not.toBeInTheDocument();
  });

  it("con roles:manage: togglear un permiso y guardar manda el SET COMPLETO por CÓDIGO, y dispara resync que refresca el store", async () => {
    const user = userEvent.setup();
    // El actor debe POSEER "sales:manage" para poder agregarlo (D5): no está
    // en el baseline de Cajero (["sales:read"]), así que sin el permiso el
    // checkbox estaría deshabilitado — eso ya lo cubre `permission-checklist.test.tsx`.
    useAuthStore
      .getState()
      .setAuth("jwt-demo", demoUser(["roles:read", "roles:manage", "sales:manage"]));
    const updatedCajero: rbacApi.RoleSummary = {
      ...(ROLES[0] as rbacApi.RoleSummary),
      permissionCodes: ["sales:read", "sales:manage"],
    };
    mockedApi.updateRole.mockResolvedValue(updatedCajero);
    mockedGetMe.mockResolvedValue(demoUser(["roles:read", "roles:manage", "sales:manage"]));

    await renderRoute("/system/roles");
    await user.click(await screen.findByRole("button", { name: "Cajero" }));
    await user.click(await screen.findByRole("checkbox", { name: "sales:manage" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // `updateRole` viaja envuelto en un arrow inline (`({id, input}) => updateRole(id, input)`),
    // no como referencia directa — NO recibe el 2do argumento de contexto de
    // TanStack Query (gotcha documentado en batch 1, ver hooks.ts).
    await waitFor(() =>
      expect(mockedApi.updateRole).toHaveBeenCalledWith("r1", {
        permissionCodes: expect.arrayContaining(["sales:read", "sales:manage"]),
      }),
    );
    const [, updateInput] = mockedApi.updateRole.mock.calls[0] as [
      string,
      { permissionCodes: string[] },
    ];
    // Set COMPLETO, no delta: exactamente los 2 codes marcados, ninguno de más.
    expect(updateInput.permissionCodes).toHaveLength(2);

    await waitFor(() => expect(mockedGetMe).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useAuthStore.getState().user?.permissions).toEqual([
        "roles:read",
        "roles:manage",
        "sales:manage",
      ]),
    );
  });

  it("crear rol: llama createRole y el rol nuevo aparece en la lista", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["roles:read", "roles:manage"]));
    const newRole: rbacApi.RoleSummary = {
      id: "r3",
      name: "Soporte",
      permissionCodes: [],
      userCount: 0,
    };
    mockedApi.listRoles.mockResolvedValueOnce(ROLES).mockResolvedValueOnce([...ROLES, newRole]);
    mockedApi.createRole.mockResolvedValue(newRole);

    await renderRoute("/system/roles");
    await screen.findByRole("button", { name: "Cajero" });
    await user.click(screen.getByRole("button", { name: "Nuevo rol" }));
    await user.type(screen.getByLabelText("Nombre del rol"), "Soporte");
    await user.click(screen.getByRole("button", { name: "Crear rol" }));

    await waitFor(() =>
      expect(mockedApi.createRole).toHaveBeenCalledWith(
        { name: "Soporte", permissionCodes: [] },
        expect.anything(),
      ),
    );
    expect(await screen.findByRole("button", { name: "Soporte" })).toBeInTheDocument();
  });

  it("eliminar rol sin usuarios asignados: confirma y llama deleteRole", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["roles:read", "roles:manage"]));
    mockedApi.listRoles
      .mockResolvedValueOnce(ROLES)
      .mockResolvedValueOnce([ROLES[0] as rbacApi.RoleSummary]);
    mockedApi.deleteRole.mockResolvedValue(undefined);

    await renderRoute("/system/roles");
    await screen.findByRole("button", { name: "Cajero" });
    const deleteButtons = screen.getAllByRole("button", { name: "Eliminar" });
    await user.click(deleteButtons[1] as HTMLElement);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.deleteRole).toHaveBeenCalledWith("r2", expect.anything()));
    confirmSpy.mockRestore();
  });

  it("eliminar rol CON usuarios asignados: 'Eliminar' está deshabilitado (previene roles.role_in_use)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["roles:read", "roles:manage"]));

    await renderRoute("/system/roles");
    await screen.findByRole("button", { name: "Cajero" });
    const deleteButtons = screen.getAllByRole("button", { name: "Eliminar" });
    expect(deleteButtons[0]).toBeDisabled();
  });

  it("guardar con 409 roles.last_admin_protected muestra el error sin romper la vista", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(["roles:read", "roles:manage"]));
    mockedApi.updateRole.mockRejectedValue({
      statusCode: 409,
      message: "No podés quitarle estos permisos al último administrador activo.",
      error: "Conflict",
      code: "roles.last_admin_protected",
    });

    await renderRoute("/system/roles");
    await user.click(await screen.findByRole("button", { name: "Cajero" }));
    await user.click(await screen.findByRole("checkbox", { name: "roles:manage" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(
      await screen.findByText("No podés quitarle estos permisos al último administrador activo."),
    ).toBeInTheDocument();
    // La vista sigue en pie: el rol y su selección no desaparecen.
    expect(screen.getByRole("button", { name: "Cajero" })).toBeInTheDocument();
    expect(mockedGetMe).not.toHaveBeenCalled();
  });
});
