import { Inject, Injectable, Logger } from "@nestjs/common";
import { GRACE_DAYS, graceEndsAt, localCalendarDate } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MAILER, type MailerPort, type MailTemplate } from "../mail/mailer.port";
import { EntitlementsService } from "./entitlements.service";

const DIA_MS = 86_400_000;

type SubAfectada = {
  id: string;
  tenantId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  dueAt: Date | null;
  graceEndsAt: Date | null;
  plan: { name: string };
};

type Negocio = { id: string; name: string; timezone: string };

/**
 * F7-CRON — el barrido diario del ciclo de cobro.
 *
 * ── La regla de oro ─────────────────────────────────────────────────────
 * Este job SOLO DEGRADA: trial vencido → free; due vencido → past_due (o
 * canceled si el cliente ya se despidió con cancel_at_period_end); gracia
 * vencida → free. PROMOVER es siempre un acto humano (registrar el pago en
 * el backoffice) — un bug aquí no puede regalar un plan.
 *
 * ── Idempotencia por construcción ───────────────────────────────────────
 * Las transiciones son `updateMany … WHERE status='X'`: si otra pasada (o
 * una segunda instancia) ya movió la fila, el count es 0 y no se audita ni
 * se avisa dos veces. Los avisos rebotan en el UNIQUE de
 * `billing_notifications` (P2002 = ya enviado). Correr el job dos veces es
 * inofensivo — y `POST /admin/billing/jobs/run-daily` existe justo para eso.
 *
 * ── Contextos ───────────────────────────────────────────────────────────
 * Las LECTURAS cross-tenant pasan por `withBillingAdminContext` (la única
 * puerta); cada MUTACIÓN + su audit corren dentro del `withTenantContext`
 * del tenant afectado (audit_logs tiene RLS). El mail sale DESPUÉS del
 * commit, best-effort — un SMTP caído jamás revierte una transición.
 */
@Injectable()
export class BillingDailyJob {
  private readonly logger = new Logger(BillingDailyJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly entitlements: EntitlementsService,
    @Inject(MAILER) private readonly mailer: MailerPort,
  ) {}

  async run(now: Date): Promise<void> {
    const tocados = new Set<string>([
      ...(await this.expireTrials(now)),
      ...(await this.openGrace(now)),
      ...(await this.expireGrace(now)),
    ]);
    await this.sendReminders(now);
    await this.invalidateCaches([...tocados]);
    this.logger.log(`Barrido diario de billing: ${tocados.size} suscripciones movidas`);
  }

  /** trialing con el trial vencido → free. */
  async expireTrials(now: Date): Promise<string[]> {
    const vencidas = await this.buscar({ status: "trialing", trialEndsAt: { lte: now } });
    const negocios = await this.negociosDe(vencidas);
    const tocados: string[] = [];

    for (const sub of vencidas) {
      const movida = await this.transicionar(sub, { status: "free" }, "trialing", now, negocios, {
        kind: "trial_ended",
        template: "trial-ended",
        anchorAt: sub.trialEndsAt ?? now,
      });
      if (movida) {
        tocados.push(sub.tenantId);
      }
    }
    return tocados;
  }

  /**
   * active con el vencimiento pasado → past_due con 10 días de gracia del
   * calendario del NEGOCIO — o directo a canceled si el cliente ya pidió no
   * renovar: su período pagado se respetó completo y no hay nada que cobrar.
   */
  async openGrace(now: Date): Promise<string[]> {
    const vencidas = await this.buscar({ status: "active", dueAt: { lte: now } });
    const negocios = await this.negociosDe(vencidas);
    const tocados: string[] = [];

    for (const sub of vencidas) {
      const negocio = negocios.get(sub.tenantId);
      const tz = negocio?.timezone ?? "UTC";

      if (sub.cancelAtPeriodEnd) {
        const movida = await this.transicionar(
          sub,
          { status: "canceled" },
          "active",
          now,
          negocios,
          null,
        );
        if (movida) {
          tocados.push(sub.tenantId);
        }
        continue;
      }

      // La fecha LEGIBLE del vencimiento: el instante guardado es límite
      // abierto (arranque del día siguiente), su día es el del ms anterior.
      const fechaVencimiento = localCalendarDate(tz, new Date((sub.dueAt ?? now).getTime() - 1));
      const movida = await this.transicionar(
        sub,
        { status: "past_due", graceEndsAt: graceEndsAt(fechaVencimiento, tz) },
        "active",
        now,
        negocios,
        {
          kind: "past_due",
          template: "payment-past-due",
          anchorAt: sub.dueAt ?? now,
          vars: { deadline: fechaVencimiento, daysLeft: String(GRACE_DAYS) },
        },
      );
      if (movida) {
        tocados.push(sub.tenantId);
      }
    }
    return tocados;
  }

  /** past_due con la gracia vencida → free (el "día 11"). */
  async expireGrace(now: Date): Promise<string[]> {
    const vencidas = await this.buscar({ status: "past_due", graceEndsAt: { lte: now } });
    const negocios = await this.negociosDe(vencidas);
    const tocados: string[] = [];

    for (const sub of vencidas) {
      const movida = await this.transicionar(sub, { status: "free" }, "past_due", now, negocios, {
        kind: "downgraded",
        template: "plan-downgraded",
        anchorAt: sub.graceEndsAt ?? now,
      });
      if (movida) {
        tocados.push(sub.tenantId);
      }
    }
    return tocados;
  }

  /** Los avisos preventivos: T-3 del trial, T-7 y T-3 del vencimiento, T-3 de la gracia. */
  async sendReminders(now: Date): Promise<void> {
    const en3d = new Date(now.getTime() + 3 * DIA_MS);
    const en7d = new Date(now.getTime() + 7 * DIA_MS);

    const proximas = await this.prisma.withBillingAdminContext((tx) =>
      tx.tenantSubscription.findMany({
        where: {
          OR: [
            { status: "trialing", trialEndsAt: { gt: now, lte: en3d } },
            { status: "active", dueAt: { gt: now, lte: en7d } },
            { status: "past_due", graceEndsAt: { gt: now, lte: en3d } },
          ],
        },
        include: { plan: { select: { name: true } } },
      }),
    );
    const negocios = await this.negociosDe(proximas as SubAfectada[]);

    for (const sub of proximas as SubAfectada[]) {
      const negocio = negocios.get(sub.tenantId);
      const tz = negocio?.timezone ?? "UTC";

      if (sub.status === "trialing" && sub.trialEndsAt) {
        await this.avisar(sub, negocios, {
          kind: "trial_ending",
          template: "trial-ending",
          anchorAt: sub.trialEndsAt,
          vars: {
            deadline: localCalendarDate(tz, new Date(sub.trialEndsAt.getTime() - 1)),
            daysLeft: String(this.diasHasta(sub.trialEndsAt, now)),
          },
        });
      }

      if (sub.status === "active" && sub.dueAt) {
        const deadline = localCalendarDate(tz, new Date(sub.dueAt.getTime() - 1));
        await this.avisar(sub, negocios, {
          kind: "due_soon_7",
          template: "payment-due-soon",
          anchorAt: sub.dueAt,
          vars: { deadline },
        });
        if (sub.dueAt.getTime() - now.getTime() <= 3 * DIA_MS) {
          await this.avisar(sub, negocios, {
            kind: "due_soon_3",
            template: "payment-due-soon",
            anchorAt: sub.dueAt,
            vars: { deadline },
          });
        }
      }

      if (sub.status === "past_due" && sub.graceEndsAt) {
        await this.avisar(sub, negocios, {
          kind: "grace_ending",
          template: "payment-past-due",
          anchorAt: sub.graceEndsAt,
          vars: {
            deadline: localCalendarDate(tz, new Date(sub.graceEndsAt.getTime() - 1)),
            daysLeft: String(this.diasHasta(sub.graceEndsAt, now)),
          },
        });
      }
    }
  }

  async invalidateCaches(tenantIds: string[]): Promise<void> {
    for (const tenantId of tenantIds) {
      await this.entitlements.invalidate(tenantId);
    }
  }

  // ── Piezas internas ─────────────────────────────────────────────────────

  private buscar(where: Prisma.TenantSubscriptionWhereInput): Promise<SubAfectada[]> {
    return this.prisma.withBillingAdminContext((tx) =>
      tx.tenantSubscription.findMany({ where, include: { plan: { select: { name: true } } } }),
    ) as Promise<SubAfectada[]>;
  }

  /** Los nombres y zonas de los negocios afectados — `tenants` no lleva RLS. */
  private async negociosDe(subs: SubAfectada[]): Promise<Map<string, Negocio>> {
    if (subs.length === 0) {
      return new Map();
    }
    const filas = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(subs.map((s) => s.tenantId))] } },
      select: { id: true, name: true, timezone: true },
    });
    return new Map(filas.map((f) => [f.id, f]));
  }

  /**
   * La transición idempotente: `updateMany WHERE status=esperado`. Un count
   * de 0 significa que otra pasada ya la hizo — ni audit ni aviso dobles.
   */
  private async transicionar(
    sub: SubAfectada,
    data: Prisma.TenantSubscriptionUpdateManyMutationInput,
    statusEsperado: string,
    _now: Date,
    negocios: Map<string, Negocio>,
    aviso: {
      kind: string;
      template: MailTemplate;
      anchorAt: Date;
      vars?: Record<string, string>;
    } | null,
  ): Promise<boolean> {
    const resultado = await this.prisma.withTenantContext(sub.tenantId, async (tx) => {
      const { count } = await tx.tenantSubscription.updateMany({
        where: { tenantId: sub.tenantId, status: statusEsperado },
        data,
      });
      if (count === 0) {
        return null;
      }
      // Audit SIN userId: la transición es del sistema, no de una persona.
      await this.auditService.record(tx, {
        tenantId: sub.tenantId,
        action: "billing.status_changed",
        resourceType: "subscription",
        resourceId: sub.id,
        before: { status: statusEsperado },
        after: { status: String(data.status) },
      });
      return { movida: true };
    });

    if (resultado && aviso) {
      await this.avisar(sub, negocios, aviso);
    }
    return resultado !== null;
  }

  /** El aviso con dedup: INSERT primero (el UNIQUE manda), mail después. */
  private async avisar(
    sub: SubAfectada,
    negocios: Map<string, Negocio>,
    aviso: { kind: string; template: MailTemplate; anchorAt: Date; vars?: Record<string, string> },
  ): Promise<void> {
    const destinatario = await this.prisma
      .withTenantContext(sub.tenantId, async (tx) => {
        await tx.billingNotification.create({
          data: {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            kind: aviso.kind,
            anchorAt: aviso.anchorAt,
          },
        });
        return tx.user.findFirst({
          where: {
            tenantId: sub.tenantId,
            status: "active",
            roles: {
              some: { role: { permissions: { some: { permission: { code: "tenants:manage" } } } } },
            },
          },
          orderBy: { createdAt: "asc" },
          select: { email: true, firstName: true, locale: true },
        });
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "P2002") {
          return null; // Ya avisado: el UNIQUE hizo su trabajo.
        }
        throw error;
      });

    if (!destinatario) {
      return;
    }

    const negocio = negocios.get(sub.tenantId);
    this.mailer
      .send({
        to: destinatario.email,
        template: aviso.template,
        locale: destinatario.locale === "en" ? "en" : "es",
        vars: {
          firstName: destinatario.firstName,
          tenantName: negocio?.name ?? "",
          planName: sub.plan.name,
          ...aviso.vars,
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Fallo al enviar ${aviso.template}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private diasHasta(deadline: Date, now: Date): number {
    return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / DIA_MS));
  }
}
