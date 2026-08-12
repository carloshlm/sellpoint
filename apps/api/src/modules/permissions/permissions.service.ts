import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

export interface PermissionGroup {
  module: string;
  permissions: Array<{ code: string; description: string | null }>;
}

/**
 * F1-RBAC-05. `permissions` es el catálogo GLOBAL del sistema (sin
 * `tenant_id`, sin RLS — ver schema.prisma) — a diferencia de TODO el resto
 * de RBAC/auth, esto NUNCA pasa por `withTenantContext`: no hay contexto de
 * tenant que resolver para leer un catálogo que es igual para todos.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listGroupedByModule(): Promise<PermissionGroup[]> {
    const rows = await this.prisma.permission.findMany({
      select: { code: true, module: true, description: true },
      orderBy: [{ module: "asc" }, { code: "asc" }],
    });

    const groups = new Map<string, PermissionGroup>();
    for (const row of rows) {
      const group = groups.get(row.module) ?? { module: row.module, permissions: [] };
      group.permissions.push({ code: row.code, description: row.description });
      groups.set(row.module, group);
    }

    return [...groups.values()];
  }
}
