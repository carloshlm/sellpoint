import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  addBillingPeriod,
  type BillingCycle,
  type Currency,
  computeChargeAmount,
  dueInstant,
  formatMoney,
  graceEndsAt,
  localCalendarDate,
  type PlanCode,
  resolveAnchorDay,
  resolveMarket,
  type SubscriptionPaymentMethod,
  scaledInteger,
} from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MAILER, type MailerPort } from "../mail/mailer.port";
import { EntitlementsService } from "./entitlements.service";

export interface RecordPaymentInput {
  tenantId: string;
  billingCycle: BillingCycle;
  method: SubscriptionPaymentMethod;
  paidAt: Date;
  /** Cambia el plan en el mismo acto (caso típico: fin de trial Plus → paga Basic). */
  planCode?: PlanCode;
  /** Lo que el cliente transfirió de verdad. Obligatorio: la cuenta cuadra o no se registra. */
  amountReceived: string;
  /** Lo perdonado en ESTE pago, encima del cupón vigente. */
  discountAmount?: string;
  gatewayReference?: string;
  /** Override explícito: "reactivar desde hoy sin cobrar los meses muertos". */
  periodStart?: Date;
  notes?: string;
  recordedBy?: string;
}

/**
 * F7-CORE-04/05/06 — el motor de cobro MANUAL.
 *
 * Reglas que este servicio custodia (y sus tests fijan):
 *  - PROMOVER es siempre humano: la única puerta hacia `active` es un pago
 *    registrado (o `reactivate` dentro del período vivo). El cron solo
 *    degrada.
 *  - El ancla se fija con el PRIMER pago y el siguiente vencimiento avanza
 *    desde la FECHA del vencimiento anterior (31-ene → 28-feb → 31-mar).
 *  - Un pago tardío no regala días; free → active re-ancla al día del pago
 *    (los meses muertos no se cobran ni se acreditan).
 *  - Los montos registrados son los CALCULADOS (el CHECK de la base exige
 *    amount = gross − discount); si el cliente pagó otra cifra, la
 *    diferencia queda en notas — el período JAMÁS se deriva del monto.
 *  - Un pago no se borra: se anula con razón y el período se recalcula
 *    desde los pagos vivos.
 *  - Cancelar con período vivo deja `cancel_at_period_end` con el status
 *    intacto (semántica Stripe): el servicio pagado se respeta hasta el
 *    corte y el CRON hace la transición al vencer.
 */
/** Centavos → texto decimal, sin IEEE-754 (mismo criterio que shared). */
function centavosATexto(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly entitlements: EntitlementsService,
    @Inject(MAILER) private readonly mailer: MailerPort,
  ) {}

  async recordPayment(input: RecordPaymentInput) {
    const { tenantId } = input;

    const resultado = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      // El negocio ANTERIOR a la Fase 7 no tiene fila: registrarle un pago
      // es darlo de alta. Nace sin trial —ya pagó, no está probando— y con
      // el plan que el pago declare, porque no hay ninguno del que heredar.
      const sub =
        (await tx.tenantSubscription.findUnique({
          where: { tenantId },
          include: { plan: true },
        })) ?? (await this.crearSuscripcionDesdePago(tx, tenantId, input.planCode));

      if (sub.status === "canceled") {
        // La reactivación es un acto explícito del backoffice, no un efecto
        // colateral de capturar un pago.
        throw new UnprocessableEntityException({ message: "billing.subscription_canceled" });
      }

      const plan = input.planCode
        ? await tx.plan.findUniqueOrThrow({ where: { code: input.planCode } })
        : sub.plan;

      const price = await this.resolvePrice(tx, plan.id, tenant);
      if (!price && sub.customPrice === null) {
        // La invariante de Premium, con su clave i18n — el Error genérico de
        // shared es para quien programa, no para quien cobra.
        throw new UnprocessableEntityException({ message: "billing.custom_price_required" });
      }
      const discount = await this.resolveActiveDiscount(tx, tenantId, input.paidAt);
      const cargo = computeChargeAmount({
        price: price
          ? { monthly: String(price.priceMonthly), yearly: String(price.priceYearly) }
          : null,
        cycle: input.billingCycle,
        customPrice: sub.customPrice === null ? null : String(sub.customPrice),
        discount: discount
          ? {
              kind: discount.kind as "fixed_amount" | "free",
              amount: discount.amount === null ? null : String(discount.amount),
            }
          : null,
      });

      const tz = tenant.timezone;

      // Un pago es un HECHO: "este cliente me transfirió". Un hecho futuro no
      // existe — es un error de dedo en el año, el mes o el día, y no uno
      // inofensivo: ese pago contaría para el MRR y otorgaría período.
      //
      // Se compara el DÍA del negocio y no el instante: el formulario captura
      // "hoy" como mediodía local, que en UTC ya puede ser mañana. Rechazar
      // eso sería rechazar la operación más común del backoffice.
      if (localCalendarDate(tz, input.paidAt) > localCalendarDate(tz, new Date())) {
        throw new UnprocessableEntityException({ message: "billing.paid_at_in_future" });
      }
      // free re-ancla y arranca en el día del pago: sus meses muertos no se
      // cobran. El resto encadena con el período anterior (no se regalan
      // días) salvo override explícito del backoffice.
      const desdeFree = sub.status === "free";
      const periodStart =
        input.periodStart ?? (desdeFree ? input.paidAt : (sub.servicePeriodEnd ?? input.paidAt));
      const anchorDay =
        desdeFree || sub.anchorDay === null ? resolveAnchorDay(input.paidAt, tz) : sub.anchorDay;

      // La fecha desde la que avanza el ancla: si el período encadena con un
      // vencimiento anterior, es LA FECHA de ese vencimiento (el instante
      // guardado es el arranque del día siguiente — límite abierto — así que
      // su día legible es el del milisegundo anterior). Si arranca en un
      // instante nuevo (primer pago, free, override), es su propio día local.
      const encadena = !input.periodStart && !desdeFree && sub.servicePeriodEnd !== null;
      const fromDueDate = encadena
        ? localCalendarDate(tz, new Date(periodStart.getTime() - 1))
        : localCalendarDate(tz, periodStart);
      const dueDate = addBillingPeriod(fromDueDate, input.billingCycle, anchorDay);
      const dueAt = dueInstant(dueDate, tz);

      // ── LA CUENTA TIENE QUE CUADRAR ───────────────────────────────────
      //
      //     recibido + descuento (cupón + el de este pago) = precio de lista
      //
      // Es la regla de un libro de caja, y reemplaza al viejo "pago parcial
      // forzado con una nota": un cobro incompleto se captura como DESCUENTO
      // explícito — un dato que se puede sumar, auditar y explicar, en vez de
      // prosa dentro de un campo de texto.
      //
      // Y tiene un efecto secundario feliz: con la cuenta cuadrada, `amount`
      // ES el monto recibido. El dato queda consistente por construcción, sin
      // una columna más que mantener sincronizada.
      const descuentoExtra = scaledInteger(input.discountAmount ?? "0", 2);
      const descuentoTotal = scaledInteger(cargo.discount, 2) + descuentoExtra;
      const brutoCents = scaledInteger(cargo.gross, 2);

      if (descuentoTotal > brutoCents) {
        // Cobrar en negativo no existe: un descuento mayor que el precio es
        // un error de captura, no una decisión comercial.
        throw new UnprocessableEntityException({
          message: "billing.discount_above_charge",
          args: { discount: centavosATexto(descuentoTotal), gross: cargo.gross },
        });
      }

      const netoEsperado = centavosATexto(brutoCents - descuentoTotal);
      if (scaledInteger(input.amountReceived, 2) !== brutoCents - descuentoTotal) {
        throw new UnprocessableEntityException({
          message: "billing.amount_mismatch",
          args: {
            received: input.amountReceived,
            expected: netoEsperado,
            gross: cargo.gross,
            discount: centavosATexto(descuentoTotal),
          },
        });
      }

      const notas = input.notes ?? null;

      const payment = await tx.subscriptionPayment.create({
        data: {
          tenantId,
          subscriptionId: sub.id,
          planId: plan.id,
          planCode: plan.code,
          billingCycle: input.billingCycle,
          grossAmount: cargo.gross,
          discountAmount: centavosATexto(descuentoTotal),
          amount: netoEsperado,
          currency: price?.currency ?? tenant.currency,
          discountId: discount?.id ?? null,
          method: input.method,
          gatewayReference: input.gatewayReference,
          paidAt: input.paidAt,
          periodStart,
          periodEnd: dueAt,
          recordedBy: input.recordedBy,
          notes: notas || null,
        },
      });

      if (discount) {
        await tx.tenantDiscount.update({
          where: { id: discount.id },
          data: { appliedPeriods: { increment: 1 } },
        });
      }

      const actualizada = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          status: "active",
          planId: plan.id,
          billingCycle: input.billingCycle,
          anchorDay,
          servicePeriodStart: periodStart,
          servicePeriodEnd: dueAt,
          dueAt,
          graceEndsAt: null,
        },
      });

      await this.auditService.record(tx, {
        tenantId,
        userId: input.recordedBy,
        action: "billing.payment_recorded",
        resourceType: "subscription_payment",
        resourceId: payment.id,
        before: { status: sub.status, planCode: sub.plan.code },
        after: {
          status: "active",
          planCode: plan.code,
          amount: cargo.net,
          periodEnd: dueAt.toISOString(),
        },
      });

      const destinatario = await this.resolveBillingRecipient(tx, tenantId);
      return {
        payment,
        subscription: actualizada,
        destinatario,
        tenant,
        plan,
        cobrado: netoEsperado,
        dueDate,
      };
    });

    await this.entitlements.invalidate(tenantId);
    this.sendBillingMail(resultado.destinatario, {
      template: "payment-received",
      tenantName: resultado.tenant.name,
      planName: resultado.plan.name,
      amount: formatMoney(
        Number(resultado.cobrado),
        (resultado.payment.currency as Currency) ?? "MXN",
        resultado.destinatario?.locale === "en" ? "en" : "es",
      ),
      periodEnd: resultado.dueDate,
    });

    return resultado.payment;
  }

  /**
   * Da de alta la suscripción de un negocio que no tenía ninguna — los
   * anteriores a la Fase 7, que hoy viven en modo gratuito por el
   * fail-closed del resolver.
   *
   * Nace `free` y sin trial: el estado real hasta que el pago que la está
   * creando la mueva a `active` unas líneas más abajo. Exige `planCode`
   * porque no hay plan previo del que heredar y adivinar qué contrató el
   * cliente sería inventar dinero.
   */
  private async crearSuscripcionDesdePago(
    tx: Prisma.TransactionClient,
    tenantId: string,
    planCode: PlanCode | undefined,
  ) {
    if (!planCode) {
      throw new UnprocessableEntityException({ message: "billing.plan_required" });
    }
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: planCode } });
    const creada = await tx.tenantSubscription.create({
      data: { tenantId, planId: plan.id, status: "free" },
    });

    await this.auditService.record(tx, {
      tenantId,
      action: "billing.subscription_created",
      resourceType: "subscription",
      resourceId: creada.id,
      after: { planCode: plan.code, origen: "alta desde pago del backoffice" },
    });

    return { ...creada, plan };
  }

  async voidPayment(
    tenantId: string,
    paymentId: string,
    input: { reason: string; voidedBy: string },
  ) {
    const resultado = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const payment = await tx.subscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.status === "voided") {
        throw new ConflictException({ message: "billing.payment_already_voided" });
      }

      const anulado = await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          status: "voided",
          voidedAt: new Date(),
          voidedBy: input.voidedBy,
          voidReason: input.reason,
        },
      });

      // El período se RECALCULA desde los pagos vivos: anular es corregir la
      // historia, y el estado presente se deriva de la historia corregida.
      const sub = await tx.tenantSubscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });
      if (!sub) {
        throw new NotFoundException({ message: "billing.subscription_not_found" });
      }
      const vivos = await tx.subscriptionPayment.findMany({
        where: { subscriptionId: sub.id, status: "recorded" },
        orderBy: { periodEnd: "desc" },
      });

      const ahora = new Date();
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      let data: Prisma.TenantSubscriptionUpdateInput;
      const masReciente = vivos[0];
      if (masReciente) {
        const fin = masReciente.periodEnd;
        if (fin > ahora) {
          data = { status: "active", servicePeriodEnd: fin, dueAt: fin, graceEndsAt: null };
        } else {
          const fecha = localCalendarDate(tenant.timezone, new Date(fin.getTime() - 1));
          const gracia = graceEndsAt(fecha, tenant.timezone);
          data =
            gracia > ahora
              ? { status: "past_due", servicePeriodEnd: fin, dueAt: fin, graceEndsAt: gracia }
              : { status: "free", servicePeriodEnd: fin, dueAt: fin };
        }
      } else if (sub.trialEndsAt && sub.trialEndsAt > ahora) {
        data = {
          status: "trialing",
          servicePeriodStart: null,
          servicePeriodEnd: null,
          dueAt: null,
        };
      } else {
        data = { status: "free", servicePeriodStart: null, servicePeriodEnd: null, dueAt: null };
      }

      const actualizada = await tx.tenantSubscription.update({ where: { tenantId }, data });

      await this.auditService.record(tx, {
        tenantId,
        userId: input.voidedBy,
        action: "billing.payment_voided",
        resourceType: "subscription_payment",
        resourceId: paymentId,
        before: { status: sub.status },
        after: { status: actualizada.status, reason: input.reason },
      });

      return anulado;
    });

    await this.entitlements.invalidate(tenantId);
    return resultado;
  }

  async changePlan(
    tenantId: string,
    input: {
      planCode?: PlanCode;
      customPrice?: string | null;
      billingCycle?: BillingCycle;
      anchorDay?: number;
      notes?: string | null;
      reason: string;
      changedBy?: string;
    },
  ) {
    const resultado = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const sub = await tx.tenantSubscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });
      if (!sub) {
        throw new NotFoundException({ message: "billing.subscription_not_found" });
      }

      const plan = input.planCode
        ? await tx.plan.findUniqueOrThrow({ where: { code: input.planCode } })
        : sub.plan;
      const price = await this.resolvePrice(tx, plan.id, tenant);
      const customPrice =
        input.customPrice ?? (sub.customPrice === null ? null : String(sub.customPrice));
      if (!price && customPrice === null) {
        // La invariante de Premium: plan sin precio publicado exige precio pactado.
        throw new UnprocessableEntityException({ message: "billing.custom_price_required" });
      }

      const actualizada = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          planId: plan.id,
          ...(input.customPrice !== undefined ? { customPrice: input.customPrice } : {}),
          ...(input.billingCycle !== undefined ? { billingCycle: input.billingCycle } : {}),
          // El ancla a mano es palanca de RESCATE del backoffice: normalmente
          // la fija el primer pago y nunca se toca.
          ...(input.anchorDay !== undefined ? { anchorDay: input.anchorDay } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });

      await this.auditService.record(tx, {
        tenantId,
        userId: input.changedBy,
        action: "billing.plan_changed",
        resourceType: "subscription",
        resourceId: sub.id,
        before: { planCode: sub.plan.code },
        after: { planCode: plan.code, reason: input.reason },
      });

      return actualizada;
    });

    await this.entitlements.invalidate(tenantId);
    return resultado;
  }

  async cancel(tenantId: string, input: { reason: string; canceledBy?: string }) {
    const resultado = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const sub = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      if (!sub) {
        throw new NotFoundException({ message: "billing.subscription_not_found" });
      }

      // El status NO se toca: el servicio pagado se respeta hasta el corte y
      // la transición a `canceled` la hace el CRON al vencer (la regla de
      // oro: este método no degrada a nadie).
      const actualizada = await tx.tenantSubscription.update({
        where: { tenantId },
        data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
      });

      await this.auditService.record(tx, {
        tenantId,
        userId: input.canceledBy,
        action: "billing.canceled",
        resourceType: "subscription",
        resourceId: sub.id,
        after: { reason: input.reason, cancelAtPeriodEnd: true },
      });

      return actualizada;
    });

    await this.entitlements.invalidate(tenantId);
    return resultado;
  }

  async reactivate(tenantId: string, input: { reason: string; reactivatedBy?: string }) {
    const resultado = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const sub = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      if (!sub) {
        throw new NotFoundException({ message: "billing.subscription_not_found" });
      }
      if (!sub.servicePeriodEnd || sub.servicePeriodEnd <= new Date()) {
        // Con el período vencido no hay nada que revivir: la puerta es un pago.
        throw new UnprocessableEntityException({ message: "billing.reactivation_window_over" });
      }

      const actualizada = await tx.tenantSubscription.update({
        where: { tenantId },
        data: { cancelAtPeriodEnd: false, canceledAt: null },
      });

      await this.auditService.record(tx, {
        tenantId,
        userId: input.reactivatedBy,
        action: "billing.reactivated",
        resourceType: "subscription",
        resourceId: sub.id,
        after: { reason: input.reason },
      });

      return actualizada;
    });

    await this.entitlements.invalidate(tenantId);
    return resultado;
  }

  async grantDiscount(
    tenantId: string,
    input: {
      kind: "fixed_amount" | "free";
      amount?: string;
      startsAt: Date;
      endsAt?: Date;
      maxPeriods?: number;
      reason: string;
      createdBy?: string;
    },
  ) {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      try {
        const discount = await tx.tenantDiscount.create({
          data: {
            tenantId,
            kind: input.kind,
            amount: input.kind === "fixed_amount" ? input.amount : null,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            maxPeriods: input.maxPeriods,
            reason: input.reason,
            createdBy: input.createdBy,
          },
        });

        await this.auditService.record(tx, {
          tenantId,
          userId: input.createdBy,
          action: "billing.discount_granted",
          resourceType: "tenant_discount",
          resourceId: discount.id,
          after: { kind: input.kind, amount: input.amount, reason: input.reason },
        });

        return discount;
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          // El UNIQUE parcial manda: un solo cupón activo — se revoca el
          // vigente y se otorga el nuevo, no se apilan.
          throw new ConflictException({ message: "billing.discount_overlap" });
        }
        throw error;
      }
    });
  }

  async revokeDiscount(
    tenantId: string,
    discountId: string,
    input: { reason: string; revokedBy?: string },
  ) {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const discount = await tx.tenantDiscount.update({
        where: { id: discountId },
        data: { isActive: false },
      });

      await this.auditService.record(tx, {
        tenantId,
        userId: input.revokedBy,
        action: "billing.discount_revoked",
        resourceType: "tenant_discount",
        resourceId: discountId,
        after: { reason: input.reason },
      });

      return discount;
    });
  }

  /**
   * F7-WEB-02 — la pantalla de planes: el catálogo publicable con el precio
   * del MERCADO pedido (fallback US para países sin tarifa propia). Free se
   * excluye (no se vende: es a donde se cae) y Premium sale con precio null —
   * su CTA es "Contactar", el precio se pacta por cliente.
   */
  async listPublicPlans(country: string) {
    const planes = await this.prisma.plan.findMany({
      where: { isActive: true, code: { not: "free" } },
      include: { prices: true },
      orderBy: { sortOrder: "asc" },
    });

    return planes.map((plan) => {
      const price =
        plan.prices.find((p) => p.country === country) ??
        plan.prices.find((p) => p.country === "US") ??
        null;
      return {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        maxUsers: plan.maxUsers,
        maxWarehouses: plan.maxWarehouses,
        features: plan.features,
        price: price
          ? {
              currency: price.currency,
              monthly: String(price.priceMonthly),
              yearly: String(price.priceYearly),
            }
          : null,
      };
    });
  }

  /**
   * La fila del MERCADO del tenant, o la tarifa US (default internacional).
   *
   * El mercado sale de `resolveMarket` —país, o moneda si el tenant es
   * anterior al onboarding— y no de `country` a secas: un negocio con "MXN"
   * en su fila y el país en NULL habría sido COBRADO en dólares. Es la misma
   * función que usa la vitrina de planes, a propósito: mostrar un precio y
   * cobrar otro sería el peor error posible de este módulo.
   */
  private async resolvePrice(
    tx: Prisma.TransactionClient,
    planId: string,
    tenant: { country: string | null; currency: string },
  ) {
    const market = resolveMarket(tenant);
    const local = await tx.planPrice.findUnique({
      where: { planId_country: { planId, country: market } },
    });
    if (local) {
      return local;
    }
    return tx.planPrice.findUnique({ where: { planId_country: { planId, country: "US" } } });
  }

  /** El cupón activo, solo si está vigente y le quedan períodos. */
  private async resolveActiveDiscount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paidAt: Date,
  ) {
    const discount = await tx.tenantDiscount.findFirst({
      where: { tenantId, isActive: true },
    });
    if (!discount) {
      return null;
    }
    if (discount.startsAt > paidAt) {
      return null;
    }
    if (discount.endsAt && discount.endsAt < paidAt) {
      return null;
    }
    if (discount.maxPeriods !== null && discount.appliedPeriods >= discount.maxPeriods) {
      return null;
    }
    return discount;
  }

  /** El usuario activo más antiguo con `tenants:manage`: el dueño, en la práctica. */
  private async resolveBillingRecipient(tx: Prisma.TransactionClient, tenantId: string) {
    return tx.user.findFirst({
      where: {
        tenantId,
        status: "active",
        roles: {
          some: {
            role: { permissions: { some: { permission: { code: "tenants:manage" } } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      select: { email: true, firstName: true, locale: true },
    });
  }

  /** Post-commit y best-effort, patrón F1: un mail caído jamás revierte un pago. */
  private sendBillingMail(
    destinatario: { email: string; firstName: string; locale: string } | null,
    vars: {
      template: "payment-received";
      tenantName: string;
      planName: string;
      amount: string;
      periodEnd: string;
    },
  ): void {
    if (!destinatario) {
      this.logger.warn("Pago registrado sin destinatario de correo (tenant sin admin activo)");
      return;
    }
    this.mailer
      .send({
        to: destinatario.email,
        template: vars.template,
        locale: destinatario.locale === "en" ? "en" : "es",
        vars: {
          firstName: destinatario.firstName,
          tenantName: vars.tenantName,
          planName: vars.planName,
          amount: vars.amount,
          periodEnd: vars.periodEnd,
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Fallo al enviar payment-received: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
