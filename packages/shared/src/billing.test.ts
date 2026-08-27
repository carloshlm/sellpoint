import { describe, expect, it } from "vitest";
import {
  addBillingPeriod,
  BILLING_CYCLES,
  computeChargeAmount,
  DISCOUNT_KINDS,
  dueInstant,
  GRACE_DAYS,
  graceEndsAt,
  PLAN_CODES,
  planFeaturesSchema,
  resolveAnchorDay,
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_STATUSES,
  subscriptionBlockSchema,
  TRIAL_DAYS,
} from "./billing";

/**
 * F7-SHARED — la matemática del dinero y del calendario de cobro, PURA.
 *
 * La pieza crítica de toda la fase es el ANCLA: el día del mes al que se
 * ancla el cobro se fija con el primer pago y NUNCA se recalcula. El próximo
 * vencimiento se deriva de la FECHA del vencimiento anterior (no del instante
 * en que arranca el período): si se derivara del arranque, la cadena
 * 31-ene → 28-feb → 31-mar se rompería en el segundo salto (el período que
 * sigue al 28-feb arranca el 1-mar, y "mes siguiente" sería abril).
 */
const CDMX = "America/Mexico_City";

describe("contratos de billing (F7-SHARED-01)", () => {
  it("los catálogos cerrados coinciden con los CHECKs de la base", () => {
    expect(PLAN_CODES).toEqual(["free", "basic", "pro", "plus", "premium"]);
    expect(SUBSCRIPTION_STATUSES).toEqual(["trialing", "active", "past_due", "free", "canceled"]);
    expect(BILLING_CYCLES).toEqual(["monthly", "yearly"]);
    expect(SUBSCRIPTION_PAYMENT_METHODS).toEqual(["transfer", "cash", "card", "other", "courtesy"]);
    expect(DISCOUNT_KINDS).toEqual(["fixed_amount", "free"]);
    expect(TRIAL_DAYS).toBe(14);
    expect(GRACE_DAYS).toBe(10);
  });

  const FEATURES_PLUS = {
    pos: true,
    compositions: true,
    quotes: true,
    movements: true,
    transfers: true,
    lots: true,
    custom_fields: true,
    custom_roles: true,
    reports: true,
    reports_export: true,
  };

  it("planFeaturesSchema acepta la matriz completa", () => {
    expect(planFeaturesSchema.parse(FEATURES_PLUS)).toEqual(FEATURES_PLUS);
  });

  it("planFeaturesSchema rechaza una key desconocida — un typo en el JSONB revienta en tests, no en producción", () => {
    expect(() => planFeaturesSchema.parse({ ...FEATURES_PLUS, lotes: true })).toThrow();
  });

  it("planFeaturesSchema rechaza una matriz incompleta — cada flag es una decisión, no un default", () => {
    const { lots: _lots, ...incompleta } = FEATURES_PLUS;
    expect(() => planFeaturesSchema.parse(incompleta)).toThrow();
  });

  it("subscriptionBlockSchema valida el bloque que emiten login y GET /me", () => {
    const bloque = {
      planCode: "plus",
      planName: "Plus",
      status: "trialing",
      billingCycle: null,
      trialEndsAt: "2026-09-10T05:59:59.999Z",
      dueAt: null,
      graceEndsAt: null,
      daysLeft: 14,
      writeAccess: true,
      stockControl: true,
      dailySalesLimit: null,
      features: FEATURES_PLUS,
    };
    expect(subscriptionBlockSchema.parse(bloque)).toEqual(bloque);
    expect(() => subscriptionBlockSchema.parse({ ...bloque, status: "expired" })).toThrow();
  });
});

describe("resolveAnchorDay (F7-SHARED-02)", () => {
  it("el ancla es el día del mes en el calendario del NEGOCIO, no en UTC", () => {
    // Las 23:30 locales del 5-ago en CDMX son las 05:30 UTC del 6-ago: en UTC
    // ya es día 6, pero el cliente pagó el 5 y su ancla es 5.
    expect(resolveAnchorDay(new Date("2026-08-06T05:30:00.000Z"), CDMX)).toBe(5);
  });

  it("un pago a fin de mes fija el ancla en 31", () => {
    expect(resolveAnchorDay(new Date("2026-01-31T18:00:00.000Z"), CDMX)).toBe(31);
  });
});

describe("addBillingPeriod (F7-SHARED-02)", () => {
  it("mensual: del 5-ago al 5-sep", () => {
    expect(addBillingPeriod("2026-08-05", "monthly", 5)).toBe("2026-09-05");
  });

  it("anual: del 5-ago-2026 al 5-ago-2027", () => {
    expect(addBillingPeriod("2026-08-05", "yearly", 5)).toBe("2027-08-05");
  });

  it("mensual con mes corto: 31-ene se recorta al 28-feb", () => {
    expect(addBillingPeriod("2026-01-31", "monthly", 31)).toBe("2026-02-28");
  });

  it("el ancla VUELVE tras el recorte: del 28-feb al 31-mar, no al 28-mar", () => {
    // Esta es la razón de guardar anchor_day como columna: si el siguiente
    // vencimiento se derivara del 28 resultante, el cliente del 31 quedaría
    // convertido en cliente del 28 para siempre.
    expect(addBillingPeriod("2026-02-28", "monthly", 31)).toBe("2026-03-31");
  });

  it("la cadena completa del cliente del 31: mar → abr → may", () => {
    expect(addBillingPeriod("2026-03-31", "monthly", 31)).toBe("2026-04-30");
    expect(addBillingPeriod("2026-04-30", "monthly", 31)).toBe("2026-05-31");
  });

  it("febrero bisiesto recorta al 29", () => {
    expect(addBillingPeriod("2028-01-31", "monthly", 31)).toBe("2028-02-29");
  });

  it("anual desde un 29-feb bisiesto cae al 28-feb del año siguiente", () => {
    expect(addBillingPeriod("2028-02-29", "yearly", 29)).toBe("2029-02-28");
  });

  it("cruza el fin de año: del 15-dic al 15-ene", () => {
    expect(addBillingPeriod("2026-12-15", "monthly", 15)).toBe("2027-01-15");
  });

  it("un ancla fuera de 1-31 es un bug del caller y lanza", () => {
    expect(() => addBillingPeriod("2026-08-05", "monthly", 0)).toThrow();
    expect(() => addBillingPeriod("2026-08-05", "monthly", 32)).toThrow();
  });
});

describe("dueInstant y graceEndsAt (F7-SHARED-02)", () => {
  it("«vence el 5-sep» = el 5-sep completo es hábil: el instante es el ARRANQUE del 6 local (límite abierto, criterio de day-range)", () => {
    // El cron degrada con `due_at <= now()`: cualquier momento del 5 local
    // todavía no venció; las 00:00 del 6 sí. Ni un milisegundo se pierde.
    expect(dueInstant("2026-09-05", CDMX).toISOString()).toBe("2026-09-06T06:00:00.000Z");
  });

  it("la gracia son 10 días completos después del vencimiento: se degrada al día 11", () => {
    // Vence el 5 (hábil), gracia del 6 al 15 — el instante de degradación es
    // el arranque del 16 local.
    expect(graceEndsAt("2026-09-05", CDMX).toISOString()).toBe("2026-09-16T06:00:00.000Z");
  });

  it("la gracia cruza el fin de mes sin inventar fechas", () => {
    expect(graceEndsAt("2026-08-25", CDMX).toISOString()).toBe("2026-09-05T06:00:00.000Z");
  });
});

describe("computeChargeAmount (F7-SHARED-03)", () => {
  const PLUS_MX = { monthly: "499.00", yearly: "4990.00" };

  it("plan publicado, ciclo mensual, sin cupón", () => {
    expect(
      computeChargeAmount({ price: PLUS_MX, cycle: "monthly", customPrice: null, discount: null }),
    ).toEqual({ gross: "499.00", discount: "0.00", net: "499.00" });
  });

  it("el ciclo anual toma el precio anual", () => {
    expect(
      computeChargeAmount({ price: PLUS_MX, cycle: "yearly", customPrice: null, discount: null }),
    ).toEqual({ gross: "4990.00", discount: "0.00", net: "4990.00" });
  });

  it("cupón de monto fijo: Plus $499 − $200 = $299", () => {
    expect(
      computeChargeAmount({
        price: PLUS_MX,
        cycle: "monthly",
        customPrice: null,
        discount: { kind: "fixed_amount", amount: "200.00" },
      }),
    ).toEqual({ gross: "499.00", discount: "200.00", net: "299.00" });
  });

  it("el cupón tiene piso en cero: $600 sobre Basic $199 deja 0, jamás un cobro negativo", () => {
    expect(
      computeChargeAmount({
        price: { monthly: "199.00", yearly: "1990.00" },
        cycle: "monthly",
        customPrice: null,
        discount: { kind: "fixed_amount", amount: "600.00" },
      }),
    ).toEqual({ gross: "199.00", discount: "199.00", net: "0.00" });
  });

  it("cupón `free`: el descuento es el bruto completo y el neto queda en cero", () => {
    expect(
      computeChargeAmount({
        price: PLUS_MX,
        cycle: "monthly",
        customPrice: null,
        discount: { kind: "free", amount: null },
      }),
    ).toEqual({ gross: "499.00", discount: "499.00", net: "0.00" });
  });

  it("Premium: el custom_price del tenant ES el precio del período pactado", () => {
    expect(
      computeChargeAmount({
        price: null,
        cycle: "monthly",
        customPrice: "1250.00",
        discount: null,
      }),
    ).toEqual({ gross: "1250.00", discount: "0.00", net: "1250.00" });
  });

  it("custom_price presente gana sobre el precio publicado — es un override por tenant", () => {
    expect(
      computeChargeAmount({
        price: PLUS_MX,
        cycle: "monthly",
        customPrice: "350.00",
        discount: null,
      }),
    ).toEqual({ gross: "350.00", discount: "0.00", net: "350.00" });
  });

  it("plan sin precio publicado y sin custom_price es un estado inválido y lanza", () => {
    // La invariante de Premium: no hay CHECK cross-tabla en la base, la
    // impone este código — y este test la fija.
    expect(() =>
      computeChargeAmount({ price: null, cycle: "monthly", customPrice: null, discount: null }),
    ).toThrow();
  });

  it("los centavos no pasan por IEEE-754: $0.10 × 3 períodos de descuento no inventa decimales", () => {
    expect(
      computeChargeAmount({
        price: { monthly: "0.30", yearly: "3.00" },
        cycle: "monthly",
        customPrice: null,
        discount: { kind: "fixed_amount", amount: "0.10" },
      }),
    ).toEqual({ gross: "0.30", discount: "0.10", net: "0.20" });
  });
});
