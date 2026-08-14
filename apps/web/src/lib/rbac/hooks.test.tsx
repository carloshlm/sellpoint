import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createQueryClient } from "@/lib/query-client";
import type { PermissionGroup, RoleSummary, UserDetail } from "./api";
import * as rbacApi from "./api";
import {
  PERMISSIONS_QUERY_KEY,
  ROLES_QUERY_KEY,
  USERS_QUERY_KEY,
  useCreateRole,
  useCreateUser,
  useDeleteRole,
  usePermissionsCatalog,
  useReactivateUser,
  useResendInvitation,
  useRoles,
  useSuspendUser,
  useUpdateRole,
  useUpdateUser,
  useUsers,
} from "./hooks";

// F1-WEB-USERS WU1: al contrario de `lib/auth/hooks.ts` (donde la
// invalidación vive en cada container), acá vive DENTRO del hook — igual
// criterio que `watchSessionIdentity`: una consecuencia que no se puede
// olvidar, no un paso que cada container tenga que acordarse de repetir.
vi.mock("./api", () => ({
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

const USER: UserDetail = {
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "García",
  lastNameMaternal: null,
  status: "invited",
  locale: "es",
  roles: [],
};

const ROLE: RoleSummary = { id: "r1", name: "Cajero", permissionCodes: [], userCount: 0 };

const PERMISSION_GROUPS: PermissionGroup[] = [
  { module: "users", permissions: [{ code: "users:read", description: null }] },
];

function wrapper() {
  const queryClient = createQueryClient();
  return {
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    queryClient,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.listUsers.mockResolvedValue([USER]);
  mockedApi.listRoles.mockResolvedValue([ROLE]);
  mockedApi.listPermissions.mockResolvedValue(PERMISSION_GROUPS);
});

describe("query keys", () => {
  it("son estables y namespaced bajo 'rbac'", () => {
    expect(USERS_QUERY_KEY).toEqual(["rbac", "users"]);
    expect(ROLES_QUERY_KEY).toEqual(["rbac", "roles"]);
    expect(PERMISSIONS_QUERY_KEY).toEqual(["rbac", "permissions"]);
  });
});

describe("queries", () => {
  it("useUsers trae la lista vía listUsers", async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUsers(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual([USER]));
    expect(mockedApi.listUsers).toHaveBeenCalledTimes(1);
  });

  it("useRoles trae la lista vía listRoles", async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRoles(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual([ROLE]));
  });

  it("usePermissionsCatalog trae el catálogo agrupado por módulo", async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => usePermissionsCatalog(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(PERMISSION_GROUPS));
  });
});

describe("mutaciones de usuarios invalidan USERS_QUERY_KEY", () => {
  it("useCreateUser refresca la lista al crear", async () => {
    mockedApi.createUser.mockResolvedValue(USER);
    const { Wrapper, queryClient } = wrapper();
    const { result: usersResult } = renderHook(() => useUsers(), { wrapper: Wrapper });
    await waitFor(() => expect(usersResult.current.data).toEqual([USER]));

    const { result: mutation } = renderHook(() => useCreateUser(), { wrapper: Wrapper });
    mutation.current.mutate({
      email: "b@acme.mx",
      firstName: "B",
      lastNamePaternal: "B",
      roleIds: ["r1"],
    });

    await waitFor(() => expect(mutation.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(USERS_QUERY_KEY)?.isInvalidated).toBe(false);
    // Se refresca de verdad: listUsers se llamó de nuevo tras el mutate.
    await waitFor(() => expect(mockedApi.listUsers).toHaveBeenCalledTimes(2));
  });

  it("useUpdateUser / useSuspendUser / useReactivateUser / useResendInvitation invalidan la lista", async () => {
    mockedApi.updateUser.mockResolvedValue(USER);
    mockedApi.suspendUser.mockResolvedValue(USER);
    mockedApi.reactivateUser.mockResolvedValue(USER);
    mockedApi.resendInvitation.mockResolvedValue(USER);

    const { Wrapper } = wrapper();
    const { result: usersResult } = renderHook(() => useUsers(), { wrapper: Wrapper });
    await waitFor(() => expect(usersResult.current.data).toEqual([USER]));

    const { result: update } = renderHook(() => useUpdateUser(), { wrapper: Wrapper });
    update.current.mutate({ id: "u1", input: { firstName: "Ana2" } });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));

    const { result: suspend } = renderHook(() => useSuspendUser(), { wrapper: Wrapper });
    suspend.current.mutate("u1");
    await waitFor(() => expect(suspend.current.isSuccess).toBe(true));

    const { result: reactivate } = renderHook(() => useReactivateUser(), { wrapper: Wrapper });
    reactivate.current.mutate("u1");
    await waitFor(() => expect(reactivate.current.isSuccess).toBe(true));

    const { result: resend } = renderHook(() => useResendInvitation(), { wrapper: Wrapper });
    resend.current.mutate("u1");
    await waitFor(() => expect(resend.current.isSuccess).toBe(true));

    // 1 inicial + 4 refrescos por cada mutación exitosa.
    await waitFor(() => expect(mockedApi.listUsers).toHaveBeenCalledTimes(5));
  });
});

describe("mutaciones de roles invalidan ROLES_QUERY_KEY", () => {
  it("useCreateRole / useUpdateRole / useDeleteRole refrescan la lista de roles", async () => {
    mockedApi.createRole.mockResolvedValue(ROLE);
    mockedApi.updateRole.mockResolvedValue(ROLE);
    mockedApi.deleteRole.mockResolvedValue(undefined);

    const { Wrapper } = wrapper();
    const { result: rolesResult } = renderHook(() => useRoles(), { wrapper: Wrapper });
    await waitFor(() => expect(rolesResult.current.data).toEqual([ROLE]));

    const { result: create } = renderHook(() => useCreateRole(), { wrapper: Wrapper });
    create.current.mutate({ name: "Nuevo", permissionCodes: [] });
    await waitFor(() => expect(create.current.isSuccess).toBe(true));

    const { result: update } = renderHook(() => useUpdateRole(), { wrapper: Wrapper });
    update.current.mutate({ id: "r1", input: { name: "Editado" } });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));

    const { result: remove } = renderHook(() => useDeleteRole(), { wrapper: Wrapper });
    remove.current.mutate("r1");
    await waitFor(() => expect(remove.current.isSuccess).toBe(true));

    // 1 inicial + 3 refrescos por cada mutación exitosa.
    await waitFor(() => expect(mockedApi.listRoles).toHaveBeenCalledTimes(4));
  });
});
