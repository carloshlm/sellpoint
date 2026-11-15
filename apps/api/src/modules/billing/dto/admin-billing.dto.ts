import {
  BILLING_CYCLES,
  moduleKeySchema,
  PLAN_CODES,
  planFeaturesSchema,
  SUBSCRIPTION_PAYMENT_METHODS,
} from "@sellpoint/shared";
import { z } from "zod";

// F7-ADMIN — los cuerpos del backoffice. Todo lo que muta lleva `reason`
// obligatoria: cada palanca del dueño deja rastro en audit_logs con su
// porqué, no solo con su qué.

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "billing.invalid_amount");

export const recordPaymentSchema = z.object({
  billingCycle: z.enum(BILLING_CYCLES),
  method: z.enum(SUBSCRIPTION_PAYMENT_METHODS),
  /**
   * El DÍA del negocio (`YYYY-MM-DD`). Se acepta también un instante ISO por
   * compatibilidad, pero el backoffice manda el día: un pago se captura
   * mirando un calendario, y convertirlo a instante en el navegador lo corría
   * de día cuando el negocio estaba en otra zona (Carlos, 2026-09-04).
   */
  paidAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.coerce.date()]),
  /** Cambia el plan en el mismo acto (fin de trial Plus → paga Basic). */
  planCode: z.enum(PLAN_CODES).optional(),
  /**
   * Lo que el cliente transfirió DE VERDAD. Obligatorio: registrar un cobro
   * sin decir cuánto entró es lo único que un libro de caja no admite.
   */
  amountReceived: money,
  /**
   * Lo que se le perdona en ESTE pago, encima del cupón vigente. La cuenta
   * tiene que cuadrar — recibido + descuento = precio del plan — y por eso
   * el faltante se captura como descuento y no como una nota suelta.
   */
  discountAmount: money.optional(),
  gatewayReference: z.string().trim().max(128).optional(),
  /** Override explícito: "reactivar desde hoy sin cobrar los meses muertos". */
  periodStart: z.coerce.date().optional(),
  /**
   * «Cubre hasta» (Carlos, 2026-11-14): el último día cubierto, en el
   * calendario del negocio. Igual al automático no cambia nada; distinto es
   * un ACUERDO y exige `agreedPrice` y el motivo en `notes`.
   */
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    // Una fecha que no existe («2026-02-31», «2026-12-00») no es un error de
    // formato sino de dedo: el regex la deja pasar y `Date` la recorre.
    .refine(
      (dia) => {
        const fecha = new Date(`${dia}T00:00:00.000Z`);
        return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === dia;
      },
      { message: "billing.period_end_invalid" },
    )
    .optional(),
  /** El precio del acuerdo: recibido + descuento tiene que dar esto. Puede ser 0. */
  agreedPrice: money.optional(),
  notes: z.string().trim().max(500).optional(),
});
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

/**
 * La cotización que pinta «Debe pagar» y «Cubre del … al …» en el diálogo:
 * la MISMA cuenta que hace el pago, para que la pantalla y el API no puedan
 * decir dos precios distintos.
 */
export const paymentQuoteQuerySchema = z
  .object({
    billingCycle: z.enum(BILLING_CYCLES),
    planCode: z.enum(PLAN_CODES).optional(),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type PaymentQuoteQueryDto = z.infer<typeof paymentQuoteQuerySchema>;

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidPaymentDto = z.infer<typeof voidPaymentSchema>;

export const patchSubscriptionSchema = z
  .object({
    planCode: z.enum(PLAN_CODES).optional(),
    customPrice: money.nullable().optional(),
    billingCycle: z.enum(BILLING_CYCLES).optional(),
    anchorDay: z.number().int().min(1).max(31).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (data) => Object.entries(data).some(([key, value]) => key !== "reason" && value !== undefined),
    { message: "billing.invalid_body" },
  );
export type PatchSubscriptionDto = z.infer<typeof patchSubscriptionSchema>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReasonDto = z.infer<typeof reasonSchema>;

/**
 * F9-MOD-05 — activar un módulo avanzado. `customPrice` es opcional a
 * propósito: la invariante «Premium exige precio pactado» la impone
 * `changePlan` (422), no este schema — una sola fuente de verdad.
 */
export const enableModuleSchema = z.object({
  moduleKey: moduleKeySchema,
  customPrice: money.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});
export type EnableModuleDto = z.infer<typeof enableModuleSchema>;

export const grantDiscountSchema = z
  .object({
    kind: z.enum(["fixed_amount", "free"]),
    amount: money.optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
    maxPeriods: z.number().int().positive().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((data) => data.kind !== "fixed_amount" || data.amount !== undefined, {
    message: "billing.invalid_amount",
  });
export type GrantDiscountDto = z.infer<typeof grantDiscountSchema>;

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    description: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
    maxUsers: z.number().int().positive().nullable().optional(),
    maxWarehouses: z.number().int().positive().nullable().optional(),
    dailySalesLimit: z.number().int().positive().nullable().optional(),
    features: planFeaturesSchema.optional(),
    prices: z
      .array(
        z.object({
          country: z.string().length(2),
          currency: z.string().length(3),
          priceMonthly: money,
        }),
      )
      .optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "billing.invalid_body",
  });
export type UpdatePlanDto = z.infer<typeof updatePlanSchema>;
