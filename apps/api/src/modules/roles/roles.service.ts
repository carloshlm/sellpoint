import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { PermEpochService } from "../../infrastructure/redis/perm-epoch.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { CreateRoleDto } from "./dto/create-role.dto";
import type { UpdateRoleDto } from "./dto/update-role.dto";
import { assertTenantRetainsAdmin } from "./tenant-admin-guard";

export interface RoleSummary {
  id: string;
  name: string;
  permissionCodes: string[];
  userCount: number;
}

/**
 * F1-RBAC-04. CERO SQL directo — mismo molde que UsersService/TenantsService
 * (`withTenantContext` + auditoría en la misma tx). La pieza NO negociable
 * del batch: `update()` bumpea `perm-epoch:{tenantId}` DESPUÉS del commit
 * (mismo criterio post-commit que `AuthService.resetPassword`) cuando —y
 * SOLO cuando— el set de `permissionCodes` cambió de verdad. Eso hace que
 * TODOS los usuarios del rol pierdan sus access tokens vigentes en la
 * próxima request (401 `auth.token_stale`) y el siguiente refresh les
 * resuelva los permisos frescos desde DB — sin esperar los 15 min del
 * access token.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly permEpochService: PermEpochService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async create(user: AuthUser, input: CreateRoleDto, meta: RequestMeta): Promise<RoleSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const permissionIds = await this.resolvePermissionIds(tx, input.permissionCodes);
      // W1 (verify #274, confused deputy): un rol nuevo arranca sin
      // permisos -> TODO permissionCodes pedido es "delta agregado".
      this.assertNoPrivilegeEscalation(user, input.permissionCodes, []);

      let role: { id: string; name: string };
      try {
        role = await tx.role.create({ data: { tenantId: user.tenantId, name: input.name } });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "roles.name_taken" });
        }
        throw error;
      }

      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "role.created",
        resourceType: "role",
        resourceId: role.id,
        after: { name: input.name, permissionCodes: input.permissionCodes },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return {
        id: role.id,
        name: role.name,
        permissionCodes: [...input.permissionCodes],
        userCount: 0,
      };
    });
  }

  async list(user: AuthUser): Promise<RoleSummary[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const roles = await tx.role.findMany({
        where: { tenantId: user.tenantId },
        include: {
          permissions: { select: { permission: { select: { code: true } } } },
          users: { select: { userId: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      return roles.map((role) => ({
        id: role.id,
        name: role.name,
        permissionCodes: role.permissions.map((p) => p.permission.code),
        userCount: role.users.length,
      }));
    });
  }

  async update(
    user: AuthUser,
    roleId: string,
    input: UpdateRoleDto,
    meta: RequestMeta,
  ): Promise<RoleSummary> {
    const now = this.clock.now();

    const { summary, permissionsChanged } = await this.prisma.withTenantContext(
      user.tenantId,
      async (tx) => {
        const before = await tx.role.findFirst({
          where: { id: roleId, tenantId: user.tenantId },
          include: { permissions: { select: { permission: { select: { code: true } } } } },
        });

        if (!before) {
          throw new NotFoundException({ message: "roles.not_found" });
        }

        const beforeCodes = before.permissions.map((p) => p.permission.code);

        if (input.name !== undefined) {
          try {
            await tx.role.update({ where: { id: roleId }, data: { name: input.name } });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ConflictException({ message: "roles.name_taken" });
            }
            throw error;
          }
        }

        let afterCodes = beforeCodes;
        let permissionsChanged = false;

        if (input.permissionCodes !== undefined) {
          const permissionIds = await this.resolvePermissionIds(tx, input.permissionCodes);
          // W1 (verify #274): solo se valida el DELTA agregado — bajar
          // privilegios ajenos (quitar codes que el actor tampoco posee)
          // SÍ se permite, no es escalada.
          this.assertNoPrivilegeEscalation(user, input.permissionCodes, beforeCodes);
          permissionsChanged = !sameSet(beforeCodes, input.permissionCodes);

          if (permissionsChanged) {
            await tx.rolePermission.deleteMany({ where: { roleId } });
            if (permissionIds.length > 0) {
              await tx.rolePermission.createMany({
                data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
              });
            }
            // W2 (verify #274): recién DESPUÉS de aplicar el swap, con el
            // estado ya mutado dentro de esta misma tx — si el tenant se
            // queda sin ningún admin activo, tira 409 y Prisma revierte
            // TODO (deleteMany + createMany incluidos).
            await assertTenantRetainsAdmin(tx, user.tenantId);
          }
          afterCodes = [...input.permissionCodes];
        }

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "role.updated",
          resourceType: "role",
          resourceId: roleId,
          before: { name: before.name, permissionCodes: beforeCodes },
          after: { name: input.name ?? before.name, permissionCodes: afterCodes },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        const userCount = await tx.userRole.count({ where: { roleId } });

        return {
          summary: {
            id: roleId,
            name: input.name ?? before.name,
            permissionCodes: afterCodes,
            userCount,
          },
          permissionsChanged,
        };
      },
    );

    // Post-commit a propósito (mismo criterio que AuthService.resetPassword):
    // el bump nunca debe correr dentro de la tx de dominio.
    if (permissionsChanged) {
      await this.permEpochService.bumpTenantEpoch(user.tenantId, now);
    }

    return summary;
  }

  async remove(user: AuthUser, roleId: string, meta: RequestMeta): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId: user.tenantId } });

      if (!role) {
        throw new NotFoundException({ message: "roles.not_found" });
      }

      const userCount = await tx.userRole.count({ where: { roleId } });
      if (userCount > 0) {
        throw new ConflictException({ message: "roles.role_in_use" });
      }

      await tx.role.delete({ where: { id: roleId } });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "role.deleted",
        resourceType: "role",
        resourceId: roleId,
        before: { name: role.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /**
   * R2 del design de f1-auth ("jamás consultar user_roles/role_permissions
   * sin JOIN a roles o users"): acá no hace falta el JOIN porque `permissions`
   * es el catálogo GLOBAL (sin tenant_id, sin RLS) — se resuelve fuera de
   * cualquier alcance de tenant a propósito.
   */
  private async resolvePermissionIds(
    tx: Prisma.TransactionClient,
    codes: readonly string[],
  ): Promise<string[]> {
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.length === 0) {
      return [];
    }

    const rows = await tx.permission.findMany({
      where: { code: { in: uniqueCodes } },
      select: { id: true, code: true },
    });

    if (rows.length !== uniqueCodes.length) {
      throw new BadRequestException({ message: "roles.unknown_permission_code" });
    }

    return rows.map((row) => row.id);
  }

  /**
   * W1 (hardening post-verify #274, `sdd/f1-rbac/verify-report`): confused
   * deputy / escalada de privilegios intra-tenant. Un actor con
   * `roles:manage` (y NADA más) podía otorgarle a un rol cualquier code
   * del catálogo GLOBAL vía `resolvePermissionIds()`, sin importar si el
   * actor mismo lo poseía — incluyendo su PROPIO rol, auto-escalándose en
   * el próximo refresh. Regla: nadie puede otorgar un permiso que no
   * posee. Solo se valida el DELTA AGREGADO (`requestedCodes` menos
   * `currentCodes`) — quitarle a un rol permisos que el actor tampoco
   * posee SÍ está permitido (bajar privilegios ajenos no es escalada).
   */
  private assertNoPrivilegeEscalation(
    actor: AuthUser,
    requestedCodes: readonly string[],
    currentCodes: readonly string[],
  ): void {
    const currentSet = new Set(currentCodes);
    const addedCodes = requestedCodes.filter((code) => !currentSet.has(code));
    if (addedCodes.length === 0) {
      return;
    }

    const actorPermissions = new Set(actor.permissions);
    const unheldCodes = addedCodes.filter((code) => !actorPermissions.has(code));
    if (unheldCodes.length > 0) {
      throw new ForbiddenException({ message: "roles.cannot_grant_unheld_permission" });
    }
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setA = new Set(a);
  return b.every((code) => setA.has(code));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
