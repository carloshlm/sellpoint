import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  type DeleteTenantInput,
  MODULE_KEYS,
  type ModuleKey,
  type SuspendTenantInput,
  tenantLifecycle,
} from "@sellpoint/shared";
import type Redis from "ioredis";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { HASHER, type HashPort } from "../../infrastructure/crypto/hash.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../../infrastructure/redis/redis.module";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { EntitlementsService } from "../billing/entitlements.service";

const PURGE_MAX_ATTEMPTS = 5;
const PURGE_ATTEMPTS_WINDOW_S = 15 * 60;

/** F7-LIFECYCLE-03 — el ciclo de vida del negocio, como lo pinta el backoffice. */
export interface TenantLifecycleView {
  suspendedAt: string | null;
  suspendedBy: { id: string; name: string } | null;
  reason: string | null;
  suspendedDays: number;
  deletableAt: string | null;
  deletable: boolean;
}

export interface TenantOverview {
  tenant: {
    name: string;
    country: string | null;
    currency: string;
    timezone: string;
    onboarded: boolean;
  };
  users: { active: number; invited: number; suspended: number };
  counts: { products: number; services: number; subcatalogs: number; warehouses: number };
  subscription: {
    planCode: string;
    planName: string | null;
    /** `none` cuando el negocio nunca tuvo suscripción (mismo criterio que el backoffice de cobros). */
    status: string;
    billingCycle: string | null;
    dueAt: string | null;
    customPrice: string | null;
  };
  modules: ModuleKey[];
  lifecycle: TenantLifecycleView;
}

/**
 * F9-ADMIN-02 — el resumen de UN negocio para el expediente del backoffice.
 *
 * `tenants` no lleva RLS y se lee con el cliente base; todo lo demás va en
 * UN `withTenantContext(tenantId de la URL)`: son tablas de negocio y el
 * bypass de billing no las abre (a propósito).
 */
@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(HASHER) private readonly hasher: HashPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * `viewer` es el administrador que mira: quien desactivó el negocio vive en
   * SU tenant (`users` tiene RLS), así que el nombre se lee en ese contexto.
   */
  async overview(tenantId: string, viewer: AuthUser): Promise<TenantOverview> {
    const fila = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        country: true,
        currency: true,
        timezone: true,
        onboarded: true,
        suspendedAt: true,
        suspendedById: true,
        suspendedReason: true,
      },
    });
    if (!fila) {
      throw new NotFoundException({ message: "billing.tenant_not_found" });
    }
    const { suspendedAt, suspendedById, suspendedReason, ...tenant } = fila;
    const lifecycle = await this.lifecycleDe(
      { suspendedAt, suspendedById, suspendedReason },
      viewer,
    );

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const [
        active,
        invited,
        suspended,
        products,
        services,
        subcatalogs,
        warehouses,
        sub,
        modulos,
      ] = await Promise.all([
        tx.user.count({ where: { tenantId, status: "active" } }),
        tx.user.count({ where: { tenantId, status: "invited" } }),
        tx.user.count({ where: { tenantId, status: "suspended" } }),
        tx.product.count({ where: { tenantId } }),
        tx.service.count({ where: { tenantId } }),
        // Subcatálogos = los catálogos que el negocio creó; los de sistema
        // (productos, almacenes, servicios) no son suyos.
        tx.catalog.count({ where: { tenantId, isSystem: false } }),
        tx.warehouse.count({ where: { tenantId, isActive: true } }),
        tx.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } }),
        tx.tenantModule.findMany({
          where: { tenantId },
          select: { moduleKey: true },
          orderBy: { moduleKey: "asc" },
        }),
      ]);
      const conocidas = new Set<string>(MODULE_KEYS);
      return {
        tenant,
        users: { active, invited, suspended },
        counts: { products, services, subcatalogs, warehouses },
        subscription: sub
          ? {
              planCode: sub.plan.code,
              planName: sub.plan.name,
              status: sub.status,
              billingCycle: sub.billingCycle ?? null,
              dueAt: sub.dueAt?.toISOString() ?? null,
              customPrice: sub.customPrice === null ? null : String(sub.customPrice),
            }
          : {
              planCode: "free",
              planName: null,
              status: "none",
              billingCycle: null,
              dueAt: null,
              customPrice: null,
            },
        modules: modulos.map((m) => m.moduleKey).filter((k): k is ModuleKey => conocidas.has(k)),
        lifecycle,
      };
    });
  }

  private async lifecycleDe(
    fila: {
      suspendedAt: Date | null;
      suspendedById: string | null;
      suspendedReason: string | null;
    },
    viewer: AuthUser,
  ): Promise<TenantLifecycleView> {
    const ciclo = tenantLifecycle({ suspendedAt: fila.suspendedAt }, this.clock.now());
    const quien =
      fila.suspendedById === null
        ? null
        : await this.prisma.withTenantContext(viewer.tenantId, (tx) =>
            tx.user.findUnique({
              where: { id: fila.suspendedById as string },
              select: { id: true, firstName: true, lastNamePaternal: true },
            }),
          );
    return {
      suspendedAt: fila.suspendedAt?.toISOString() ?? null,
      suspendedBy: quien
        ? { id: quien.id, name: `${quien.firstName} ${quien.lastNamePaternal}` }
        : null,
      reason: fila.suspendedReason,
      suspendedDays: ciclo.suspendedDays,
      deletableAt: ciclo.deletableAt?.toISOString() ?? null,
      deletable: ciclo.deletable,
    };
  }

  /**
   * Desactivar = «ya no entra». Reversible: fecha, quién y motivo en
   * `tenants`, y los refresh tokens del negocio borrados en la MISMA
   * transacción (la sesión muere en el próximo refresh, sin esperar al TTL).
   * La auditoría va en el negocio del ACTOR: el auditado puede desaparecer
   * después (F7-LIFECYCLE-05) y `audit_logs` cuelga de su tenant.
   */
  async suspend(
    admin: AuthUser,
    tenantId: string,
    input: SuspendTenantInput,
    meta: RequestMeta,
  ): Promise<TenantLifecycleView> {
    const negocio = await this.cargarAjeno(admin, tenantId);
    if (negocio.suspendedAt !== null) {
      throw new ConflictException({ message: "admin.tenant_already_suspended" });
    }
    const now = this.clock.now();
    await this.prisma.withTenantContext(tenantId, async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: now, suspendedById: admin.userId, suspendedReason: input.reason },
      });
      await tx.refreshToken.deleteMany({ where: { tenantId } });
      await this.auditarComoActor(tx, admin, {
        action: "tenant.suspended",
        tenantId,
        before: { suspendedAt: null },
        after: { suspendedAt: now.toISOString(), reason: input.reason },
        meta,
      });
    });
    return this.lifecycleDe(
      { suspendedAt: now, suspendedById: admin.userId, suspendedReason: input.reason },
      admin,
    );
  }

  async reactivate(
    admin: AuthUser,
    tenantId: string,
    meta: RequestMeta,
  ): Promise<TenantLifecycleView> {
    const negocio = await this.cargarAjeno(admin, tenantId);
    const desde = negocio.suspendedAt;
    if (desde === null) {
      throw new ConflictException({ message: "admin.tenant_not_suspended" });
    }
    await this.prisma.withTenantContext(tenantId, async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: null, suspendedById: null, suspendedReason: null },
      });
      await this.auditarComoActor(tx, admin, {
        action: "tenant.reactivated",
        tenantId,
        before: { suspendedAt: desde.toISOString(), reason: negocio.suspendedReason },
        after: { suspendedAt: null },
        meta,
      });
    });
    return this.lifecycleDe(
      { suspendedAt: null, suspendedById: null, suspendedReason: null },
      admin,
    );
  }

  /**
   * Eliminar = irreversible. Cuatro candados EN ORDEN, cada uno con su
   * código y cada uno dejando la base intacta:
   *  1. no es el propio negocio;
   *  2. lleva ≥ 30 días desactivado (`tenantLifecycle`; el 409 dice desde
   *     cuándo sí);
   *  3. el nombre escrito es EXACTO (lo que evita borrar el de al lado);
   *  4. la contraseña del PROPIO administrador, verificada contra su hash —
   *     no un «secreto de borrado» compartido que nadie rota — con tope de
   *     cinco fallos por 15 minutos.
   * Luego, en UNA transacción del tenant del actor: `purge_tenant()` y la
   * auditoría con el snapshot de antes y el resumen que devolvió la función.
   */
  async purge(
    admin: AuthUser,
    tenantId: string,
    input: DeleteTenantInput,
    meta: RequestMeta,
  ): Promise<{ purged: true; name: string }> {
    const negocio = await this.cargarAjeno(admin, tenantId);
    const ciclo = tenantLifecycle({ suspendedAt: negocio.suspendedAt }, this.clock.now());
    if (!ciclo.deletable) {
      throw new ConflictException({
        message: "admin.tenant_not_deletable",
        deletableAt: ciclo.deletableAt?.toISOString() ?? null,
      });
    }
    if (input.confirmName !== negocio.name) {
      throw new UnprocessableEntityException({ message: "admin.confirm_name_mismatch" });
    }
    await this.verificarPasswordDelAdmin(admin, input.password);

    // El snapshot se toma ANTES, en el contexto del negocio que se va: después
    // de la purga no queda nada que contar.
    const [users, sales] = await this.prisma.withTenantContext(tenantId, (tx) =>
      Promise.all([tx.user.count({ where: { tenantId } }), tx.sale.count({ where: { tenantId } })]),
    );
    const snapshot = {
      id: negocio.id,
      name: negocio.name,
      legalName: negocio.legalName,
      suspendedAt: negocio.suspendedAt?.toISOString() ?? null,
      suspendedReason: negocio.suspendedReason,
      users,
      sales,
    };

    await this.prisma.withTenantContext(admin.tenantId, async (tx) => {
      const [fila] = await tx.$queryRaw<
        { purge_tenant: Record<string, unknown> }[]
      >`SELECT purge_tenant(${tenantId}::uuid)`;
      await this.auditService.record(tx, {
        tenantId: admin.tenantId,
        userId: admin.userId,
        action: "tenant.purged",
        resourceType: "tenant",
        resourceId: tenantId,
        before: snapshot,
        after: (fila?.purge_tenant ?? {}) as never,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    await this.entitlements.invalidate(tenantId);
    return { purged: true, name: negocio.name };
  }

  /**
   * La contraseña del administrador que pide el borrado, contra SU hash,
   * con cinco fallos por 15 minutos en Redis (misma escala que el throttle
   * del login). Acertar libera el contador.
   */
  private async verificarPasswordDelAdmin(admin: AuthUser, password: string): Promise<void> {
    const key = `throttle:admin-purge:${admin.userId}`;
    const intentos = Number((await this.redis.get(key)) ?? 0);
    if (intentos >= PURGE_MAX_ATTEMPTS) {
      throw new HttpException({ message: "admin.too_many_attempts" }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const fila = await this.prisma.withTenantContext(admin.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: admin.userId }, select: { passwordHash: true } }),
    );
    // argon2 fuera de la transacción (AD-1 de auth): no retiene conexión.
    const valida =
      fila?.passwordHash !== null && fila?.passwordHash !== undefined
        ? await this.hasher.verify(fila.passwordHash, password)
        : false;
    if (!valida) {
      const total = await this.redis.incr(key);
      if (total === 1) {
        await this.redis.expire(key, PURGE_ATTEMPTS_WINDOW_S);
      }
      throw new UnauthorizedException({ message: "admin.password_mismatch" });
    }
    await this.redis.del(key);
  }

  /** Un negocio AJENO que existe: el backoffice nunca se toca a sí mismo. */
  private async cargarAjeno(admin: AuthUser, tenantId: string) {
    if (tenantId === admin.tenantId) {
      throw new ConflictException({ message: "admin.cannot_touch_own_tenant" });
    }
    const negocio = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, legalName: true, suspendedAt: true, suspendedReason: true },
    });
    if (!negocio) {
      throw new NotFoundException({ message: "billing.tenant_not_found" });
    }
    return negocio;
  }

  /**
   * Cambia el contexto RLS al tenant del actor DENTRO de la misma
   * transacción y escribe la auditoría ahí. `audit_logs` exige que
   * `tenant_id` coincida con `app.tenant_id` (WITH CHECK).
   */
  private async auditarComoActor(
    tx: Parameters<AuditService["record"]>[0],
    admin: AuthUser,
    entrada: {
      action: string;
      tenantId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      meta: RequestMeta;
    },
  ): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${admin.tenantId}::text, true)`;
    await this.auditService.record(tx, {
      tenantId: admin.tenantId,
      userId: admin.userId,
      action: entrada.action,
      resourceType: "tenant",
      resourceId: entrada.tenantId,
      before: entrada.before as never,
      after: entrada.after as never,
      ip: entrada.meta.ip,
      userAgent: entrada.meta.userAgent,
    });
  }

  /** El nombre del negocio como parte de un nombre de archivo. */
  async fileSlug(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const base = (tenant?.name ?? "negocio")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "negocio";
  }
}
