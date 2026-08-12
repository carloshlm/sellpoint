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
import type { CreateUserDto } from "./dto/create-user.dto";
import type { UpdateUserDto } from "./dto/update-user.dto";

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
  status: string;
  locale: string;
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
 */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly permEpochService: PermEpochService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async create(actor: AuthUser, input: CreateUserDto, meta: RequestMeta): Promise<UserDetail> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const roles = await this.resolveRoles(tx, actor.tenantId, input.roleIds);

      let user: {
        id: string;
        email: string;
        firstName: string;
        lastNamePaternal: string;
        lastNameMaternal: string | null;
        status: string;
        locale: string;
      };

      try {
        user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email: input.email,
            firstName: input.firstName,
            lastNamePaternal: input.lastNamePaternal,
            lastNameMaternal: input.lastNameMaternal,
            locale: input.locale ?? "es",
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
        } = {};
        if (input.firstName !== undefined) data.firstName = input.firstName;
        if (input.lastNamePaternal !== undefined) data.lastNamePaternal = input.lastNamePaternal;
        if (input.lastNameMaternal !== undefined) data.lastNameMaternal = input.lastNameMaternal;
        if (input.locale !== undefined) data.locale = input.locale;

        let rolesChanged = false;

        if (input.roleIds !== undefined) {
          await this.resolveRoles(tx, actor.tenantId, input.roleIds);
          const beforeRoleIds = before.roles.map((r) => r.roleId);
          rolesChanged = !sameSet(beforeRoleIds, input.roleIds);

          if (rolesChanged) {
            await tx.userRole.deleteMany({ where: { userId } });
            await tx.userRole.createMany({
              data: input.roleIds.map((roleId) => ({ userId, roleId })),
            });
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

  private async resolveRoles(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roleIds: readonly string[],
  ): Promise<UserRoleRef[]> {
    const uniqueIds = [...new Set(roleIds)];
    const roles = await tx.role.findMany({
      where: { id: { in: uniqueIds }, tenantId },
      select: { id: true, name: true },
    });

    if (roles.length !== uniqueIds.length) {
      throw new BadRequestException({ message: "users.invalid_role_ids" });
    }

    return roles;
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
    },
    roles: UserRoleRef[],
  ): UserDetail {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastNamePaternal: user.lastNamePaternal,
      lastNameMaternal: user.lastNameMaternal,
      status: user.status,
      locale: user.locale,
      roles,
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
