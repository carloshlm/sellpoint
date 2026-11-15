import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
  shortName,
  startOfDayUtc,
} from "@sellpoint/shared";
import { platformNotifyEmails } from "../../common/config/platform-admin-emails";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { MAILER, type MailerPort } from "../mail/mailer.port";
import { EntitlementsService } from "./entitlements.service";

export interface RecordPaymentInput {
  tenantId: string;
  billingCycle: BillingCycle;
  method: SubscriptionPaymentMethod;
  /**
   * El DÍA del negocio en que entró el dinero (`YYYY-MM-DD`), o el instante
   * exacto si quien llama ya lo resolvió. Un pago se registra por día: quien
   * captura mira un calendario, no un reloj (Carlos, 2026-09-04).
   */
  paidAt: Date | string;
  /** Cambia el plan en el mismo acto (caso típico: fin de trial Plus → paga Basic). */
  planCode?: PlanCode;
  /** Lo que el cliente transfirió de verdad. Obligatorio: la cuenta cuadra o no se registra. */
  amountReceived: string;
  /** Lo perdonado en ESTE pago, encima del cupón vigente. */
  discountAmount?: string;
  gatewayReference?: string;
  /** Override explícito: "reactivar desde hoy sin cobrar los meses muertos". */
  periodStart?: Date;
  /**
   * «Cubre hasta», `YYYY-MM-DD` del calendario del negocio. Distinto del fin
   * automático es un ACUERDO (Carlos, 2026-11-14): exige `agreedPrice` y el
   * motivo en `notes`.
   */
  periodEnd?: string;
  /** El precio del acuerdo; recibido + descuento tiene que dar esto. */
  agreedPrice?: string;
  notes?: string;
  recordedBy?: string;
}

/** Lo que la cotización necesita de la suscripción; un negocio sin fila cotiza como free. */
interface SuscripcionACotizar {
  status: string;
  planId: string | null;
  plan: { id: string; code: string; name: string } | null;
  servicePeriodEnd: Date | null;
  anchorDay: number | null;
  customPrice: unknown;
}

/** «Debe pagar» y «Cubre del … al …»: lo que el diálogo muestra antes de registrar. */
export interface PaymentQuote {
  /** El primer día cubierto, en el calendario del negocio. */
  periodStart: string;
  /** El último día cubierto si no hay acuerdo: el «Cubre hasta» automático. */
  periodEnd: string;
  gross: string;
  discount: string;
  net: string;
  currency: string;
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
/**
 * ── El DÍA del pago, no un instante ───────────────────────────────────
 *
 * Un `YYYY-MM-DD` se ancla al MEDIODÍA de la zona del negocio. El mediodía y
 * no la medianoche porque así el mismo día sobrevive a cualquier desfase: la
 * medianoche local cae en el día anterior en UTC y en el siguiente en otra
 * zona, y entonces «hoy» se vuelve «mañana» y el pago se rechaza por futuro.
 * Pasó con un negocio en Toronto capturado desde México (Carlos, 2026-09-04).
 */
function diaDelPago(paidAt: Date | string, timeZone: string): Date {
  return typeof paidAt === "string"
    ? new Date(startOfDayUtc(paidAt, timeZone).getTime() + 12 * 60 * 60 * 1000)
    : paidAt;
}

/** Cuánto puede cubrir un acuerdo: más de 3 años es un año mal tecleado. */
const ACUERDO_MAXIMO_ANIOS = 3;

/** El último día del mes de una fecha `YYYY-MM-DD`. */
function ultimoDiaDelMes(fecha: string): number {
  const [anio, mes] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio ?? 1970, mes ?? 1, 0)).getUTCDate();
}

/**
 * El día de cobro que deja un acuerdo: el de la fecha acordada, salvo que sea
 * FIN DE MES. «Hasta el 30 de noviembre» o «hasta el 28 de febrero» se leen
 * como «hasta fin de mes», y con un 30 o un 28 de ancla el siguiente pago
 * vencería el 30 de diciembre o el 28 de marzo para siempre. Con 31 vence el
 * último día de cada mes (`addBillingPeriod` recorta los meses cortos).
 */
function anclaDelAcuerdo(acordado: string): number {
  const dia = Number(acordado.slice(8, 10));
  return dia === ultimoDiaDelMes(acordado) ? 31 : dia;
}

/**
 * Las reglas de un «Cubre hasta» acordado. Las fechas son `YYYY-MM-DD`, así
 * que se comparan como texto.
 */
function validarAcuerdo(
  acordado: string,
  regla: { inicio: string; diaDelPago: string; agreedPrice: string | undefined; motivo: string },
): void {
  // Ni antes de que empiece el período ni antes del día del pago: un pago en
  // gracia empieza en el vencimiento anterior, y acordar una fecha que ya
  // pasó dejaría la suscripción «activa» y vencida a la vez.
  const minimo = regla.inicio > regla.diaDelPago ? regla.inicio : regla.diaDelPago;
  if (acordado < minimo) {
    throw new UnprocessableEntityException({
      message: "billing.period_end_before_start",
      args: { start: minimo },
    });
  }
  // El mismo día del inicio, tres años después; un 29 de febrero sin año
  // bisiesto se recorta al 28 para no proponer una fecha que no existe.
  const anioLimite = Number(regla.inicio.slice(0, 4)) + ACUERDO_MAXIMO_ANIOS;
  const mesLimite = regla.inicio.slice(5, 7);
  const diaLimite = Math.min(
    Number(regla.inicio.slice(8, 10)),
    ultimoDiaDelMes(`${anioLimite}-${mesLimite}-01`),
  );
  const limite = `${anioLimite}-${mesLimite}-${String(diaLimite).padStart(2, "0")}`;
  if (acordado > limite) {
    throw new UnprocessableEntityException({
      message: "billing.period_end_too_far",
      args: { max: limite },
    });
  }
  if (regla.agreedPrice === undefined) {
    throw new UnprocessableEntityException({ message: "billing.agreed_price_required" });
  }
  if (regla.motivo === "") {
    throw new UnprocessableEntityException({ message: "billing.agreement_reason_required" });
  }
}

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
    private readonly configService: ConfigService<Env, true>,
  ) {}

  /**
   * F7-CONTACT (Carlos, 2026-09-05) — «Escríbenos para activar tu plan».
   *
   * Primero se AUDITA (el mensaje queda en la base aunque el correo falle),
   * luego se avisa a los administradores de la plataforma —los de
   * `BILLING_ADMIN_EMAILS`, que son quienes activan planes— y por último se
   * le agradece al negocio en su idioma. El aviso al backoffice no es
   * best-effort: si no sale, se responde 503 para que la persona reintente;
   * el acuse sí lo es.
   */
  async requestPlan(user: AuthUser, message: string, locale: "es" | "en"): Promise<{ sent: true }> {
    const { tenant, autor } = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [tenant, autor] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true } }),
        tx.user.findUniqueOrThrow({
          where: { id: user.userId },
          select: { firstName: true, lastName: true, email: true },
        }),
      ]);
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "billing.plan_requested",
        resourceType: "tenant",
        resourceId: user.tenantId,
        after: { message },
      });
      return { tenant, autor };
    });

    const admins = platformNotifyEmails(this.configService);
    if (admins.length === 0) {
      this.logger.warn(
        "Solicitud de plan sin destinatario: PLATFORM_NOTIFY_EMAILS y BILLING_ADMIN_EMAILS están vacías",
      );
    }
    const vars = {
      tenantName: tenant.name,
      userName: shortName(autor),
      userEmail: autor.email,
      message,
    };
    try {
      // El backoffice habla español: es su idioma, no el del negocio.
      await Promise.all(
        admins.map((to) => this.mailer.send({ to, template: "plan-request", locale: "es", vars })),
      );
    } catch (error) {
      this.logger.error(
        `Fallo al avisar la solicitud de plan de ${tenant.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException({ message: "billing.plan_request_failed" });
    }
    this.mailer
      .send({
        to: autor.email,
        template: "plan-request-received",
        locale,
        vars: { firstName: autor.firstName, tenantName: tenant.name },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Fallo al enviar el acuse de la solicitud de plan: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    return { sent: true };
  }

  async recordPayment(input: RecordPaymentInput) {
    const { tenantId } = input;

    const resultado = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const paidAt = diaDelPago(input.paidAt, tenant.timezone);
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

      const cotizacion = await this.cotizarPago(tx, tenant, sub, {
        billingCycle: input.billingCycle,
        planCode: input.planCode,
        paidAt,
        periodStart: input.periodStart,
      });
      const { plan, price, discount, cargo } = cotizacion;

      const tz = tenant.timezone;

      // Un pago es un HECHO: "este cliente me transfirió". Un hecho futuro no
      // existe — es un error de dedo en el año, el mes o el día, y no uno
      // inofensivo: ese pago contaría para el MRR y otorgaría período.
      //
      // Se compara el DÍA del negocio y no el instante: el formulario captura
      // "hoy" como mediodía local, que en UTC ya puede ser mañana. Rechazar
      // eso sería rechazar la operación más común del backoffice.
      if (localCalendarDate(tz, paidAt) > localCalendarDate(tz, new Date())) {
        throw new UnprocessableEntityException({ message: "billing.paid_at_in_future" });
      }

      // ── El ORDEN de los pagos ─────────────────────────────────────────
      //
      // El período de un pago encadena con el vencimiento anterior, NO con su
      // propia fecha. Capturar uno fechado antes del último deja el historial
      // ordenado por fecha diciendo una cosa y los períodos diciendo otra: un
      // pago del día 26 cubriendo noviembre y uno del 28 cubriendo octubre.
      // Ninguno de los dos números está mal — lo que está mal es poder
      // capturarlos así (Carlos, 2026-08-29).
      //
      // Se mira solo los pagos VIVOS: anular uno libera su fecha, porque
      // anular es corregir la historia.
      const ultimo = await tx.subscriptionPayment.findFirst({
        where: { subscriptionId: sub.id, status: "recorded" },
        orderBy: { paidAt: "desc" },
        select: { paidAt: true },
      });
      if (ultimo && paidAt < ultimo.paidAt) {
        throw new UnprocessableEntityException({
          message: "billing.paid_at_before_last",
          args: { last: localCalendarDate(tz, ultimo.paidAt) },
        });
      }
      const notas = input.notes?.trim() ?? "";

      // ── «Cubre hasta» acordado (Carlos, 2026-11-14) ───────────────────
      //
      // Una fecha distinta de la automática es un ACUERDO con el cliente: el
      // precio deja de ser el de lista y pasa a ser el acordado, el motivo es
      // obligatorio y la fecha acordada se vuelve el día de cobro —los pagos
      // siguientes encadenan desde ahí—. Igual a la automática no es acuerdo.
      const acordado =
        input.periodEnd !== undefined && input.periodEnd !== cotizacion.dueDate
          ? input.periodEnd
          : null;
      if (acordado !== null) {
        validarAcuerdo(acordado, {
          inicio: cotizacion.startDate,
          diaDelPago: localCalendarDate(tz, paidAt),
          agreedPrice: input.agreedPrice,
          motivo: notas,
        });
      }
      if (cargo === null && acordado === null) {
        // La invariante de Premium, con su clave i18n — el Error genérico de
        // shared es para quien programa, no para quien cobra.
        throw new UnprocessableEntityException({ message: "billing.custom_price_required" });
      }
      const { periodStart } = cotizacion;
      const dueDate = acordado ?? cotizacion.dueDate;
      const dueAt = dueInstant(dueDate, tz);
      const anchorDay = acordado === null ? cotizacion.anchorDay : anclaDelAcuerdo(acordado);

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
      //
      // Con acuerdo, el bruto es el precio ACORDADO y el cupón no se suma: el
      // precio acordado ya es el trato.
      const descuentoExtra = scaledInteger(input.discountAmount ?? "0", 2);
      const cupon = acordado === null && cargo !== null ? scaledInteger(cargo.discount, 2) : 0;
      const descuentoTotal = cupon + descuentoExtra;
      const brutoCents =
        acordado === null && cargo !== null
          ? scaledInteger(cargo.gross, 2)
          : scaledInteger(input.agreedPrice ?? "0", 2);

      if (descuentoTotal > brutoCents) {
        // Cobrar en negativo no existe: un descuento mayor que el precio es
        // un error de captura, no una decisión comercial.
        throw new UnprocessableEntityException({
          message: "billing.discount_above_charge",
          args: { discount: centavosATexto(descuentoTotal), gross: centavosATexto(brutoCents) },
        });
      }

      const netoEsperado = centavosATexto(brutoCents - descuentoTotal);
      if (scaledInteger(input.amountReceived, 2) !== brutoCents - descuentoTotal) {
        throw new UnprocessableEntityException({
          message: "billing.amount_mismatch",
          args: {
            received: input.amountReceived,
            expected: netoEsperado,
            gross: centavosATexto(brutoCents),
            discount: centavosATexto(descuentoTotal),
          },
        });
      }

      const payment = await tx.subscriptionPayment.create({
        data: {
          tenantId,
          subscriptionId: sub.id,
          planId: plan.id,
          planCode: plan.code,
          billingCycle: input.billingCycle,
          grossAmount:
            acordado === null && cargo !== null ? cargo.gross : centavosATexto(brutoCents),
          discountAmount: centavosATexto(descuentoTotal),
          amount: netoEsperado,
          currency: price?.currency ?? tenant.currency,
          discountId: acordado === null ? (discount?.id ?? null) : null,
          method: input.method,
          gatewayReference: input.gatewayReference,
          paidAt: paidAt,
          periodStart,
          periodEnd: dueAt,
          anchorDay,
          recordedBy: input.recordedBy,
          notes: notas || null,
        },
      });

      if (discount && acordado === null) {
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
          // El precio pactado es de UN plan: si el pago cambia de plan, se
          // suelta, o el pactado de Premium se seguiría cobrando en Plus.
          ...(plan.id !== sub.planId ? { customPrice: null } : {}),
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
          amount: acordado === null && cargo !== null ? cargo.net : netoEsperado,
          periodEnd: dueAt.toISOString(),
          ...(acordado !== null && {
            coverage: { automatic: cotizacion.dueDate, agreed: acordado },
            listGross: cargo?.gross ?? null,
            reason: notas,
          }),
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
   * «Debe pagar» y «Cubre del … al …» sin registrar nada: la MISMA cuenta que
   * hace `recordPayment`. Antes el diálogo armaba el precio con su propia
   * copia y difería del API cuando había un precio pactado (Carlos,
   * 2026-11-14: «Debe pagar: 499.00» contra «precio 650.00»).
   *
   * Un negocio sin suscripción se cotiza como si viniera de free con el plan
   * elegido, sin darlo de alta: eso lo hace el pago.
   */
  async quotePayment(input: {
    tenantId: string;
    billingCycle: BillingCycle;
    planCode?: PlanCode;
    paidAt: string;
  }): Promise<PaymentQuote> {
    return this.prisma.withTenantContext(input.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
      const sub = await tx.tenantSubscription.findUnique({
        where: { tenantId: input.tenantId },
        include: { plan: true },
      });
      if (!sub && !input.planCode) {
        throw new UnprocessableEntityException({ message: "billing.plan_required" });
      }
      if (sub?.status === "canceled") {
        // Lo mismo que respondería el pago: cotizar algo que no se puede
        // registrar sería prometer una cuenta que el API va a rechazar.
        throw new UnprocessableEntityException({ message: "billing.subscription_canceled" });
      }
      const cotizacion = await this.cotizarPago(
        tx,
        tenant,
        sub ?? {
          status: "free",
          planId: null,
          plan: null,
          servicePeriodEnd: null,
          anchorDay: null,
          customPrice: null,
        },
        {
          billingCycle: input.billingCycle,
          planCode: input.planCode,
          paidAt: diaDelPago(input.paidAt, tenant.timezone),
        },
      );
      if (cotizacion.cargo === null) {
        throw new UnprocessableEntityException({ message: "billing.custom_price_required" });
      }
      return {
        periodStart: cotizacion.startDate,
        periodEnd: cotizacion.dueDate,
        gross: cotizacion.cargo.gross,
        discount: cotizacion.cargo.discount,
        net: cotizacion.cargo.net,
        currency: cotizacion.currency,
      };
    });
  }

  /**
   * La cuenta de un pago ANTES de registrarlo: plan, precio, cupón y el
   * período automático. La comparten el pago y la cotización, para que lo
   * que el diálogo propone sea exactamente lo que el pago acepta.
   *
   * `cargo` es `null` cuando el plan no publica precio y no hay pactado
   * (Premium sin acuerdo): el pago decide si eso es un error o un acuerdo.
   */
  private async cotizarPago(
    tx: Prisma.TransactionClient,
    tenant: { id: string; country: string | null; currency: string; timezone: string },
    sub: SuscripcionACotizar,
    input: { billingCycle: BillingCycle; planCode?: PlanCode; paidAt: Date; periodStart?: Date },
  ) {
    const plan = input.planCode
      ? await tx.plan.findUniqueOrThrow({ where: { code: input.planCode } })
      : sub.plan;
    if (plan === null) {
      throw new UnprocessableEntityException({ message: "billing.plan_required" });
    }

    const price = await this.resolvePrice(tx, plan.id, tenant);
    // El pactado es un acuerdo con este cliente sobre EL plan que tiene, no
    // una tarifa general: pagar otro plan cobra el precio de ese plan. Es el
    // mismo criterio del listado del backoffice (`AdminBillingService`).
    const customPrice =
      sub.planId === plan.id && sub.customPrice !== null ? String(sub.customPrice) : null;
    const discount = await this.resolveActiveDiscount(tx, tenant.id, input.paidAt);
    const cargo =
      !price && customPrice === null
        ? null
        : computeChargeAmount({
            price: price
              ? { monthly: String(price.priceMonthly), yearly: String(price.priceYearly) }
              : null,
            cycle: input.billingCycle,
            customPrice,
            discount: discount
              ? {
                  kind: discount.kind as "fixed_amount" | "free",
                  amount: discount.amount === null ? null : String(discount.amount),
                }
              : null,
          });

    const tz = tenant.timezone;
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

    return {
      plan,
      price,
      discount,
      cargo,
      currency: price?.currency ?? tenant.currency,
      periodStart,
      /** El primer día cubierto, legible. */
      startDate: localCalendarDate(tz, periodStart),
      anchorDay,
      /** El último día cubierto si no hay acuerdo. */
      dueDate: addBillingPeriod(fromDueDate, input.billingCycle, anchorDay),
    };
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
        // El día de cobro vuelve con el período: anular un acuerdo que movió
        // el ancla al 31 y dejarla ahí haría que el siguiente pago mensual,
        // encadenado desde el 15, cubriera hasta el 31 del mes que sigue. Los
        // pagos de antes no la guardaron (NULL): con ellos no se toca.
        if (masReciente.anchorDay != null) {
          data = { ...data, anchorDay: masReciente.anchorDay };
        }
      } else if (sub.trialEndsAt && sub.trialEndsAt > ahora) {
        // Sin pagos vivos tampoco queda día de cobro: el siguiente pago lo
        // vuelve a fijar en su fecha. Conservarlo dejaba el del pago anulado
        // —el de un acuerdo al 31— y el siguiente pago cubría mes y medio.
        data = {
          status: "trialing",
          anchorDay: null,
          servicePeriodStart: null,
          servicePeriodEnd: null,
          dueAt: null,
        };
      } else {
        data = {
          status: "free",
          anchorDay: null,
          servicePeriodStart: null,
          servicePeriodEnd: null,
          dueAt: null,
        };
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
        // El precio de antes y el de después: cambiar SOLO el pactado desde el
        // expediente (Carlos, 2026-11-14) dejaba una bitácora que decía «plan
        // premium → premium» sin el número que de verdad cambió.
        before: {
          planCode: sub.plan.code,
          customPrice: sub.customPrice === null ? null : String(sub.customPrice),
        },
        after: {
          planCode: plan.code,
          customPrice: actualizada.customPrice === null ? null : String(actualizada.customPrice),
          reason: input.reason,
        },
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
        // El control de inventario es columna dura y NO vive en `features`,
        // pero es la diferencia más importante del catálogo —lo que separa a
        // Basic de Pro— así que la vitrina tiene que poder decirlo.
        stockControl: plan.stockControl,
        dailySalesLimit: plan.dailySalesLimit,
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
