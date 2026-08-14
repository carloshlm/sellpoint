import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
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

const mockedApi = vi.mocked(rbacApi);

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
});
