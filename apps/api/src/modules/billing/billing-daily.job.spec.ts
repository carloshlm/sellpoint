import { BillingDailyJob } from "./billing-daily.job";

/**
 * F7-CRON — el barrido diario. La regla de oro fijada por estos tests: el
 * cron SOLO DEGRADA (trial vencido → free; due vencido → past_due o
 * canceled; gracia vencida → free) — jamás promueve. Y es idempotente por
 * construcción: las transiciones son `updateMany … WHERE status='X'` (la
 * segunda pasada mueve 0 filas) y los avisos rebotan en el UNIQUE de
 * `billing_notifications` (P2002 = ya enviado, sin mail duplicado).
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const AHORA = new Date("2026-09-16T07:00:00.000Z"); // 16-sep 01:00 CDMX

describe("BillingDailyJob (F7-CRON)", () => {
  let tx: {
    tenantSubscription: { findMany: jest.Mock; updateMany: jest.Mock };
    billingNotification: { create: jest.Mock };
    user: { findFirst: jest.Mock };
  };
  let prisma: {
    withBillingAdminContext: jest.Mock;
    withTenantContext: jest.Mock;
    tenant: { findMany: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let entitlements: { invalidate: jest.Mock };
  let mailer: { send: jest.Mock };
  let job: BillingDailyJob;

  const subRow = (extra: Record<string, unknown> = {}) => ({
    id: "sub-1",
    tenantId: TENANT,
    status: "trialing",
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    dueAt: null,
    graceEndsAt: null,
    plan: { name: "Plus" },
    ...extra,
  });

  beforeEach(() => {
    tx = {
      tenantSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      billingNotification: { create: jest.fn().mockResolvedValue({ id: "notif-1" }) },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ email: "owner@acme.test", firstName: "Ana", locale: "es" }),
      },
    };
    prisma = {
      withBillingAdminContext: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: TENANT, name: "Acme", timezone: "America/Mexico_City" }]),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    entitlements = { invalidate: jest.fn().mockResolvedValue(undefined) };
    mailer = { send: jest.fn().mockResolvedValue(undefined) };
    job = new BillingDailyJob(
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      prisma as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      audit as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      entitlements as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      mailer as any,
    );
  });

  describe("expireTrials", () => {
    it("un trial vencido cae a free, audita SIN userId y avisa trial-ended", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        subRow({ trialEndsAt: new Date("2026-09-11T06:00:00.000Z") }),
      ]);

      const tocados = await job.expireTrials(AHORA);

      expect(tx.tenantSubscription.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, status: "trialing" },
        data: { status: "free" },
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "billing.status_changed" }),
      );
      // Sin userId: la transición es del sistema, no de una persona.
      expect(audit.record.mock.calls[0][1].userId).toBeUndefined();
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: "trial-ended" }),
      );
      expect(tocados).toEqual([TENANT]);
    });

    it("si otra pasada ya lo movió (count 0), ni audita ni avisa — idempotencia", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        subRow({ trialEndsAt: new Date("2026-09-11T06:00:00.000Z") }),
      ]);
      tx.tenantSubscription.updateMany.mockResolvedValue({ count: 0 });

      const tocados = await job.expireTrials(AHORA);

      expect(audit.record).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
      expect(tocados).toEqual([]);
    });
  });

  describe("openGrace", () => {
    it("un active vencido abre gracia de 10 días del calendario del NEGOCIO y avisa past-due", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        subRow({
          status: "active",
          // Venció el 5-sep (instante = arranque del 6 local).
          dueAt: new Date("2026-09-06T06:00:00.000Z"),
        }),
      ]);

      await job.openGrace(AHORA);

      const update = tx.tenantSubscription.updateMany.mock.calls[0][0];
      expect(update.where).toEqual({ tenantId: TENANT, status: "active" });
      expect(update.data.status).toBe("past_due");
      // Gracia del 6 al 15: expira al arranque del 16 local (06:00 UTC).
      expect(update.data.graceEndsAt.toISOString()).toBe("2026-09-16T06:00:00.000Z");
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: "payment-past-due" }),
      );
    });

    it("un active vencido CON cancel_at_period_end pasa a canceled, sin gracia: el cliente ya se despidió", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        subRow({
          status: "active",
          cancelAtPeriodEnd: true,
          dueAt: new Date("2026-09-06T06:00:00.000Z"),
        }),
      ]);

      await job.openGrace(AHORA);

      const update = tx.tenantSubscription.updateMany.mock.calls[0][0];
      expect(update.data.status).toBe("canceled");
      expect(update.data.graceEndsAt).toBeUndefined();
      expect(mailer.send).not.toHaveBeenCalled();
    });
  });

  describe("expireGrace", () => {
    it("el día 11 sin pago cae a free y avisa plan-downgraded", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        subRow({ status: "past_due", graceEndsAt: new Date("2026-09-16T06:00:00.000Z") }),
      ]);

      await job.expireGrace(AHORA);

      expect(tx.tenantSubscription.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, status: "past_due" },
        data: { status: "free" },
      });
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: "plan-downgraded" }),
      );
    });
  });

  describe("sendReminders", () => {
    it("un trial a 3 días recibe trial-ending UNA vez: el UNIQUE de la base es el dedup", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        subRow({ trialEndsAt: new Date("2026-09-19T06:00:00.000Z") }),
      ]);

      await job.sendReminders(AHORA);
      expect(tx.billingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: "trial_ending" }),
      });
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: "trial-ending" }),
      );

      // Segunda corrida: el INSERT rebota con P2002 → sin mail.
      mailer.send.mockClear();
      tx.billingNotification.create.mockRejectedValue(
        Object.assign(new Error("dup"), { code: "P2002" }),
      );
      await job.sendReminders(AHORA);
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it("un active a 7 días recibe due_soon_7; a 3 días además due_soon_3 (kinds distintos)", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        subRow({ status: "active", dueAt: new Date("2026-09-19T06:00:00.000Z") }),
      ]);

      await job.sendReminders(AHORA);

      const kinds = tx.billingNotification.create.mock.calls.map((c) => c[0].data.kind);
      expect(kinds).toContain("due_soon_7");
      expect(kinds).toContain("due_soon_3");
    });
  });

  it("run() encadena los pasos e invalida el caché SOLO de los tenants tocados", async () => {
    tx.tenantSubscription.findMany
      .mockResolvedValueOnce([subRow({ trialEndsAt: new Date("2026-09-11T06:00:00.000Z") })])
      .mockResolvedValue([]);

    await job.run(AHORA);

    expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
    expect(entitlements.invalidate).toHaveBeenCalledTimes(1);
  });
});
