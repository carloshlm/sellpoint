import { api } from "@/lib/api";

/**
 * Espejo EXACTO de los DTO del API (F1-RBAC-03/04/05). Gemelo estructural de
 * `lib/auth/api.ts`: tipos + fetchers, sin lógica de React acá.
 */

export interface UserRoleRef {
  id: string;
  name: string;
}

export interface UserDetail {
  id: string;
  email: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  status: "invited" | "active" | "suspended";
  locale: string;
  roles: UserRoleRef[];
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal?: string;
  locale?: "es" | "en";
  roleIds: string[];
}

/**
 * `update-user.dto.ts` NO acepta `email` ni `status`: PATCH parcial, solo
 * estos campos (D7 del design). `roleIds`, cuando viene, reemplaza el set
 * completo — no es un delta.
 */
export type UpdateUserInput = Partial<Pick<UserDetail, "firstName" | "lastNamePaternal">> & {
  lastNameMaternal?: string;
  locale?: "es" | "en";
  roleIds?: string[];
};

export interface RoleSummary {
  id: string;
  name: string;
  permissionCodes: string[];
  userCount: number;
}

export interface CreateRoleInput {
  name: string;
  permissionCodes: string[];
}

export interface UpdateRoleInput {
  name?: string;
  permissionCodes?: string[];
}

export interface PermissionGroup {
  module: string;
  permissions: Array<{ code: string; description: string | null }>;
}

export async function listUsers(): Promise<UserDetail[]> {
  const { data } = await api.get<UserDetail[]>("/users");
  return data;
}

export async function createUser(input: CreateUserInput): Promise<UserDetail> {
  const { data } = await api.post<UserDetail>("/users", input);
  return data;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserDetail> {
  const { data } = await api.patch<UserDetail>(`/users/${id}`, input);
  return data;
}

// 200 (no 204): el backend devuelve el UserDetail actualizado tras la
// transición de estado — evita un GET extra para refrescar la fila.
export async function suspendUser(id: string): Promise<UserDetail> {
  const { data } = await api.post<UserDetail>(`/users/${id}/suspend`);
  return data;
}

export async function reactivateUser(id: string): Promise<UserDetail> {
  const { data } = await api.post<UserDetail>(`/users/${id}/reactivate`);
  return data;
}

export async function resendInvitation(id: string): Promise<UserDetail> {
  const { data } = await api.post<UserDetail>(`/users/${id}/resend-invitation`);
  return data;
}

/**
 * F2-SCOPE-02 / F3-NAV-03 — alcance por almacén de un usuario (CU-SYS-04).
 *
 * Lista VACÍA es un estado válido y SIGNIFICATIVO: sin filas el interceptor
 * del API le da todos los almacenes (default permisivo). O sea que "quitarle
 * todos los alcances" es literalmente "sacarle la restricción", no dejarlo
 * sin ver nada.
 */
export async function getWarehouseScope(userId: string): Promise<string[]> {
  const { data } = await api.get<string[]>(`/users/${userId}/warehouse-scope`);
  return data;
}

/** Reemplaza el SET completo, no un delta — la UI manda lo que quedó marcado. */
export async function replaceWarehouseScope(
  userId: string,
  warehouseIds: string[],
): Promise<string[]> {
  const { data } = await api.put<string[]>(`/users/${userId}/warehouse-scope`, { warehouseIds });
  return data;
}

export async function listRoles(): Promise<RoleSummary[]> {
  const { data } = await api.get<RoleSummary[]>("/roles");
  return data;
}

export async function createRole(input: CreateRoleInput): Promise<RoleSummary> {
  const { data } = await api.post<RoleSummary>("/roles", input);
  return data;
}

export async function updateRole(id: string, input: UpdateRoleInput): Promise<RoleSummary> {
  const { data } = await api.patch<RoleSummary>(`/roles/${id}`, input);
  return data;
}

export async function deleteRole(id: string): Promise<void> {
  await api.delete(`/roles/${id}`);
}

/** `roles:read` alcanza (F1-RBAC-05): el único consumidor es el editor de roles. */
export async function listPermissions(): Promise<PermissionGroup[]> {
  const { data } = await api.get<PermissionGroup[]>("/permissions");
  return data;
}
