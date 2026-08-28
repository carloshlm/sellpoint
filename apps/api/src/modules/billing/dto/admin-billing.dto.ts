import {
  BILLING_CYCLES,
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
  paidAt: z.coerce.date(),
  /** Cambia el plan en el mismo acto (fin de trial Plus → paga Basic). */
  planCode: z.enum(PLAN_CODES).optional(),
  /** Lo transferido de verdad; si difiere del cargo, queda en notas. */
  amountReceived: money.optional(),
  gatewayReference: z.string().trim().max(128).optional(),
  /** Override explícito: "reactivar desde hoy sin cobrar los meses muertos". */
  periodStart: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

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
