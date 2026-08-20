import {
  BadRequestException,
  ConflictException,
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
import { assertNoRoleAssignmentEscalation } from "../roles/role-assignment-guard";
import { assertTenantRetainsAdmin } from "../roles/tenant-admin-guard";
import type { CreateUserDto } from "./dto/create-user.dto";
import type { UpdateUserDto } from "./dto/update-user.dto";
import { UserInvitationService } from "./user-invitation.service";

export interface UserRoleRef {
  id: string;
  name: string;
}

interface ResolvedRole extends UserRoleRef {
  permissionCodes: string[];
}

export interface UserDetail {
  id: string;
  email: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  status: string;
  locale: string;
  /** F3-HOME-01. El almacén desde el que opera por defecto. */
  defaultWarehouseId: string | null;
  roles: UserRoleRef[];
}

/**
 * F1-RBAC-03. CRUD administrativo de usuarios (distinto de `UsersService`,
 * que es self-service para `PATCH /me`). CERO SQL directo — mismo molde.
 *
 * `suspend()` bumpea `perm-epoch:{userId}` (target, NO el actor) tras el
 * commit — mismo criterio post-commit que `RolesService.update` y
 * `AuthService.resetPassword`: mata los access tokens vigentes del usuario
 * suspendido en su próxima request, sin esperar los 15 min. login/refresh
 * ya rechazan `status=suspended` (f1-auth AUTH-REQ-04/11) — el epoch cubre
 * la ventana que ellos no cubren (un access token YA emitido y todavía
 * vigente).
 *
 * `create()`/`update()` validan `roleIds` con
 * `assertNoRoleAssignmentEscalation` (W1b, hardening post-verify #274
 * pasada 2): el actor debe poseer TODOS los permisos efectivos de los
 * roles que AGREGA. Es la misma clase de confused deputy que W1 de
 * `RolesService` (que impide ACUÑAR un permiso no poseído), por otra
 * puerta: acá nada impedía TOMAR un rol EXISTENTE que ya lo tiene.
 */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly permEpochService: PermEpochService,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly userInvitationService: UserInvitationService,
  ) {}

  async create(actor: AuthUser, input: CreateUserDto, meta: RequestMeta): Promise<UserDetail> {
    const detail = await this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const roles = await this.resolveRoles(tx, actor.tenantId, input.roleIds);
      // W1b (verify #274 pasada 2): un user nuevo arranca sin roles -> TODO
      // roleIds pedido es "delta agregado".
      assertNoRoleAssignmentEscalation(actor, roles);

      let user: {
        id: string;
        email: string;
        firstName: string;
        lastNamePaternal: string;
        lastNameMaternal: string | null;
        status: string;
        locale: string;
      };

      // El usuario nace sin alcance (lista vacía = todos), así que acá no hay
      // pertenencia que verificar: solo que el almacén exista y esté activo.
      if (input.defaultWarehouseId) {
        await this.assertAssignableWarehouse(tx, actor.tenantId, input.defaultWarehouseId, []);
      }

      try {
        user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email: input.email,
            firstName: input.firstName,
            lastNamePaternal: input.lastNamePaternal,
            lastNameMaternal: input.lastNameMaternal,
            locale: input.locale ?? "es",
            defaultWarehouseId: input.defaultWarehouseId ?? null,
            status: "invited",
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "users.email_taken" });
        }
        throw error;
      }

      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId: user.id, roleId: role.id })),
      });

      await this.auditService.record(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "user.created",
        resourceType: "user",
        resourceId: user.id,
        after: { email: input.email, roleIds: input.roleIds },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toDetail(user, roles);
    });

    // Gap S1: post-commit, nunca dentro de la tx (`password_reset_tokens` no
    // tiene RLS, AD-3). Si el alta tiró (email duplicado, escalada W1b,
    // roleIds inválidos) nunca se llega acá: no hay invitación para un
    // usuario que no existe.
    await this.userInvitationService.send({
      tenantId: actor.tenantId,
      userId: detail.id,
      email: detail.email,
      firstName: detail.firstName,
      locale: detail.locale as "es" | "en",
    });

    return detail;
  }

  /**
   * Gap S1: el mail se pierde, cae en spam, o el invitado deja vencer los 7
   * días. Re-emitir INVALIDA el link anterior
   * (`invalidatePendingPasswordResetTokens` dentro de
   * `UserInvitationService.send`) — nunca hay dos links canjeables a la vez.
   *
   * Solo para `invited`: sobre un usuario `active` sería un reset de password
   * disfrazado que un admin podría dispararle a cualquiera (el dueño de la
   * cuenta tiene `POST /auth/forgot-password` para eso), y sobre uno
   * `suspended` reviviría un acceso que se cortó a propósito.
   */
  async resendInvitation(actor: AuthUser, userId: string, meta: RequestMeta): Promise<UserDetail> {
    const detail = await this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        include: { roles: { select: { role: { select: { id: true, name: true } } } } },
      });

      if (!user) {
        throw new NotFoundException({ message: "users.not_found" });
      }

      if (user.status !== "invited") {
        throw new ConflictException({ message: "users.not_invited" });
      }

      await this.auditService.record(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "user.invitation_resent",
        resourceType: "user",
        resourceId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toDetail(
        user,
        user.roles.map((ur) => ur.role),
      );
    });

    await this.userInvitationService.send({
      tenantId: actor.tenantId,
      userId: detail.id,
      email: detail.email,
      firstName: detail.firstName,
      locale: detail.locale as "es" | "en",
    });

    return detail;
  }

  async list(actor: AuthUser): Promise<UserDetail[]> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId: actor.tenantId },
        include: { roles: { select: { role: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: "asc" },
      });

      return users.map((user) =>
        this.toDetail(
          user,
          user.roles.map((ur) => ur.role),
        ),
      );
    });
  }

  async findOne(actor: AuthUser, userId: string): Promise<UserDetail> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        include: { roles: { select: { role: { select: { id: true, name: true } } } } },
      });

      if (!user) {
        throw new NotFoundException({ message: "users.not_found" });
      }

      return this.toDetail(
        user,
        user.roles.map((ur) => ur.role),
      );
    });
  }

  async update(
    actor: AuthUser,
    userId: string,
    input: UpdateUserDto,
    meta: RequestMeta,
  ): Promise<UserDetail> {
    const now = this.clock.now();

    const { detail, rolesChanged } = await this.prisma.withTenantContext(
      actor.tenantId,
      async (tx) => {
        const before = await tx.user.findFirst({
          where: { id: userId, tenantId: actor.tenantId },
          select: { id: true, status: true, roles: { select: { roleId: true } } },
        });

        if (!before) {
          throw new NotFoundException({ message: "users.not_found" });
        }

        const data: {
          firstName?: string;
          lastNamePaternal?: string;
          lastNameMaternal?: string;
          locale?: "es" | "en";
          defaultWarehouseId?: string | null;
        } = {};
        if (input.firstName !== undefined) data.firstName = input.firstName;
        if (input.lastNamePaternal !== undefined) data.lastNamePaternal = input.lastNamePaternal;
        if (input.lastNameMaternal !== undefined) data.lastNameMaternal = input.lastNameMaternal;
        if (input.locale !== undefined) data.locale = input.locale;

        // F3-HOME-01: acá SÍ hay alcance que consultar — el usuario ya existe.
        if (input.defaultWarehouseId !== undefined) {
          if (input.defaultWarehouseId === null) {
            data.defaultWarehouseId = null;
          } else {
            const scopes = await tx.userWarehouseScope.findMany({
              where: { userId },
              select: { warehouseId: true },
            });
            await this.assertAssignableWarehouse(
              tx,
              actor.tenantId,
              input.defaultWarehouseId,
              scopes.map((scope) => scope.warehouseId),
            );
            data.defaultWarehouseId = input.defaultWarehouseId;
          }
        }

        let rolesChanged = false;

        if (input.roleIds !== undefined) {
          const roles = await this.resolveRoles(tx, actor.tenantId, input.roleIds);
          const beforeRoleIds = before.roles.map((r) => r.roleId);
          rolesChanged = !sameSet(beforeRoleIds, input.roleIds);

          if (rolesChanged) {
            // W1b (verify #274 pasada 2): solo se valida el DELTA agregado
            // (roles NUEVOS respecto de `beforeRoleIds`) — quitarle a
            // alguien roles que ya tenía no es escalada, sigue permitido
            // sin pasar por acá. DEBE correr ANTES del swap: si tira, la tx
            // no debe haber mutado nada todavía.
            const addedRoles = roles.filter((role) => !beforeRoleIds.includes(role.id));
            assertNoRoleAssignmentEscalation(actor, addedRoles);

            await tx.userRole.deleteMany({ where: { userId } });
            await tx.userRole.createMany({
              data: input.roleIds.map((roleId) => ({ userId, roleId })),
            });
            // W2 (verify #274): quitarle al ÚLTIMO admin activo su rol
            // admin (reasignándolo a otro rol) es el mismo lockout que
            // vaciarle los permisos al rol — mismo guard, mismo criterio
            // post-mutación dentro de la tx.
            await assertTenantRetainsAdmin(tx, actor.tenantId);
          }
        }

        if (Object.keys(data).length > 0) {
          await tx.user.update({ where: { id: userId }, data });
        }

        await this.auditService.record(tx, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: "user.updated",
          resourceType: "user",
          resourceId: userId,
          after: { ...data, roleIds: input.roleIds },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        const updated = await tx.user.findFirstOrThrow({
          where: { id: userId },
          include: { roles: { select: { role: { select: { id: true, name: true } } } } },
        });

        return {
          detail: this.toDetail(
            updated,
            updated.roles.map((ur) => ur.role),
          ),
          rolesChanged,
        };
      },
    );

    // Post-commit (mismo criterio que RolesService.update): cambiar los
    // roles de un user cambia sus permisos efectivos — se propaga sin
    // esperar los 15 min del access token.
    if (rolesChanged) {
      await this.permEpochService.bumpUserEpoch(userId, now);
    }

    return detail;
  }

  async suspend(actor: AuthUser, userId: string, meta: RequestMeta): Promise<UserDetail> {
    if (actor.userId === userId) {
      throw new ConflictException({ message: "users.cannot_suspend_self" });
    }

    const now = this.clock.now();

    const detail = await this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        include: { roles: { select: { role: { select: { id: true, name: true } } } } },
      });

      if (!user) {
        throw new NotFoundException({ message: "users.not_found" });
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { status: "suspended" },
      });

      // W2 (verify #274): con `status` ya mutado dentro de esta misma tx,
      // este usuario deja de contar como "activo" para la invariante — si
      // era el último admin activo del tenant, tira 409 y Prisma revierte
      // el update completo.
      await assertTenantRetainsAdmin(tx, actor.tenantId);

      await this.auditService.record(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "user.suspended",
        resourceType: "user",
        resourceId: userId,
        before: { status: user.status },
        after: { status: "suspended" },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toDetail(
        updated,
        user.roles.map((ur) => ur.role),
      );
    });

    await this.permEpochService.bumpUserEpoch(userId, now);

    return detail;
  }

  async reactivate(actor: AuthUser, userId: string, meta: RequestMeta): Promise<UserDetail> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        include: { roles: { select: { role: { select: { id: true, name: true } } } } },
      });

      if (!user) {
        throw new NotFoundException({ message: "users.not_found" });
      }

      if (user.status !== "suspended") {
        throw new ConflictException({ message: "users.not_suspended" });
      }

      const updated = await tx.user.update({ where: { id: userId }, data: { status: "active" } });

      await this.auditService.record(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "user.reactivated",
        resourceType: "user",
        resourceId: userId,
        before: { status: "suspended" },
        after: { status: "active" },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toDetail(
        updated,
        user.roles.map((ur) => ur.role),
      );
    });
  }

  /**
   * Devuelve, ADEMÁS de `{id, name}`, los `permissionCodes` efectivos de
   * cada rol — necesarios para el guard W1b (`assertNoRoleAssignmentEscalation`)
   * sin una query extra. `toDetail()` es responsable de NO filtrar
   * `permissionCodes` al DTO de respuesta.
   */
  private async resolveRoles(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roleIds: readonly string[],
  ): Promise<ResolvedRole[]> {
    const uniqueIds = [...new Set(roleIds)];
    const roles = await tx.role.findMany({
      where: { id: { in: uniqueIds }, tenantId },
      select: {
        id: true,
        name: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });

    if (roles.length !== uniqueIds.length) {
      throw new BadRequestException({ message: "users.invalid_role_ids" });
    }

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      permissionCodes: role.permissions.map((p) => p.permission.code),
    }));
  }

  /**
   * F3-HOME-01. Un almacén asignable tiene que existir, ser del tenant, estar
   * ACTIVO y —si el usuario tiene alcance— estar DENTRO de ese alcance: si no,
   * tendría por defecto un almacén que no puede operar.
   *
   * `scopeIds` se pasa explícito porque los dos llamadores lo conocen distinto:
   * al crear no hay alcance todavía, al editar hay que leerlo.
   */
  private async assertAssignableWarehouse(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    scopeIds: readonly string[],
  ): Promise<void> {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) {
      throw new ConflictException({ message: "users.default_warehouse_invalid" });
    }
    // Alcance VACÍO es "sin restricción" (default permisivo), así que nunca
    // choca: solo se valida la pertenencia cuando hay una lista de verdad.
    if (scopeIds.length > 0 && !scopeIds.includes(warehouseId)) {
      throw new ConflictException({ message: "users.default_warehouse_out_of_scope" });
    }
  }

  private toDetail(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastNamePaternal: string;
      lastNameMaternal: string | null;
      status: string;
      locale: string;
      defaultWarehouseId?: string | null;
    },
    roles: UserRoleRef[],
  ): UserDetail {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastNamePaternal: user.lastNamePaternal,
      lastNameMaternal: user.lastNameMaternal,
      defaultWarehouseId: user.defaultWarehouseId ?? null,
      status: user.status,
      locale: user.locale,
      // Reconstruido explícito: `roles` puede venir de `resolveRoles()`
      // (`ResolvedRole`, con `permissionCodes` interno para el guard W1b) —
      // nunca debe filtrarse al DTO de respuesta.
      roles: roles.map((role) => ({ id: role.id, name: role.name })),
    };
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
