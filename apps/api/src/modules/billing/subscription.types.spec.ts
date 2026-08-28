import type { Entitlements } from "./entitlements.service";
import { toSubscriptionBlock } from "./subscription.types";

/**
 * F7-WEB-01 — el bloque de suscripción que emiten login y GET /me (patrón
 * A1: un tipo, un mapper, emisores idénticos). `daysLeft` se calcula en el
 * SERVER con la zona del tenant: son días de CALENDARIO del negocio, no
 * bloques de 24 horas — a las 23:50 del día 4 "te queda 1 día", no cero.
 */
const CDMX = "America/Mexico_City";

const base: Entitlements = {
  planCode: "plus",
  planName: "Plus",
  status: "trialing",
  billingCycle: null,
  writeAccess: true,
  stockControl: true,
  dailySalesLimit: null,
  maxUsers: 20,
  maxWarehouses: 10,
  features: {
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
  },
  trialEndsAt: null,
  dueAt: null,
  graceEndsAt: null,
};

describe("toSubscriptionBlock (F7-WEB-01)", () => {
  it("en trial cuenta los días de CALENDARIO hasta el fin, en la zona del negocio", () => {
    // El trial termina al ARRANQUE del 11-sep local (fin del día 10, límite
    // abierto). Hoy es 1-sep a las 23:50 locales: quedan 9 días de
    // calendario (del 2 al 10), más el resto de hoy → daysLeft = 9.
    const block = toSubscriptionBlock(
      { ...base, trialEndsAt: "2026-09-11T06:00:00.000Z" },
      CDMX,
      new Date("2026-09-02T05:50:00.000Z"), // 1-sep 23:50 CDMX
    );
    expect(block.daysLeft).toBe(9);
    expect(block.planCode).toBe("plus");
    expect(block.status).toBe("trialing");
  });

  it("el último día del trial vale 0 días restantes, no un número negativo", () => {
    const block = toSubscriptionBlock(
      { ...base, trialEndsAt: "2026-09-11T06:00:00.000Z" },
      CDMX,
      new Date("2026-09-10T18:00:00.000Z"), // 10-sep mediodía CDMX
    );
    expect(block.daysLeft).toBe(0);
  });

  it("en past_due cuenta hacia el fin de la GRACIA", () => {
    const block = toSubscriptionBlock(
      {
        ...base,
        status: "past_due",
        dueAt: "2026-09-06T06:00:00.000Z",
        graceEndsAt: "2026-09-16T06:00:00.000Z",
      },
      CDMX,
      new Date("2026-09-10T18:00:00.000Z"), // 10-sep: la gracia cubre hasta el 15
    );
    expect(block.daysLeft).toBe(5);
  });

  it("en active cuenta hacia el vencimiento", () => {
    const block = toSubscriptionBlock(
      { ...base, status: "active", billingCycle: "monthly", dueAt: "2026-09-06T06:00:00.000Z" },
      CDMX,
      new Date("2026-09-01T18:00:00.000Z"),
    );
    expect(block.daysLeft).toBe(4);
    expect(block.billingCycle).toBe("monthly");
  });

  it("free y canceled no tienen cuenta regresiva", () => {
    const block = toSubscriptionBlock({ ...base, status: "free" }, CDMX, new Date());
    expect(block.daysLeft).toBeNull();
  });

  it("expone lo que el front necesita para pintar y gatear, nada más", () => {
    const block = toSubscriptionBlock(base, CDMX, new Date());
    expect(Object.keys(block).sort()).toEqual([
      "billingCycle",
      "dailySalesLimit",
      "daysLeft",
      "dueAt",
      "features",
      "graceEndsAt",
      "planCode",
      "planName",
      "status",
      "stockControl",
      "trialEndsAt",
      "writeAccess",
    ]);
  });
});
