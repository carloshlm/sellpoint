import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { dueInstant, localCalendarDate } from "@sellpoint/shared";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

const TZ = "America/Mexico_City";
const DIA_MS = 86_400_000;

/**
 * F7-E2E-03 — el impago: vencimiento → 10 días de gracia → día 11 en free →
 * pago tardío que reactiva.
 *
 * ── Por qué la gracia existe ────────────────────────────────────────────
 *
 * Una transferencia bancaria no es un cargo automático: se hace a mano, un
 * día que el dueño tiene tiempo. Cortarle el sistema al negocio el día
 * siguiente al vencimiento sería cobrarle la puntualidad del banco. Diez días
 * de gracia son el margen que separa "se le pasó la fecha" de "ya no quiere
 * el servicio", y durante esos diez días el negocio opera COMPLETO — con
 * avisos, pero completo.
 *
 * ── Y por qué el cron solo puede degradar ───────────────────────────────
 *
 * Las tres transiciones de este archivo las hace el barrido diario. Ninguna
 * PROMUEVE: para volver a `active` hay que registrar un pago, un acto humano.
 * Un bug en el cron puede, como mucho, degradar a alguien de más —y eso se ve
 * y se corrige—; jamás regalar un plan que nadie pagó.
 */
describe("Vencimiento, gracia y pago tardío (F7-E2E-03)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "grace-admin");
    await makePlatformAdmin(app, prisma, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  const correrBarrido = () =>
    request(app.getHttpServer())
      .post("/admin/billing/jobs/run-daily")
      .set("Authorization", bearer(admin.token))
      .send({});

  const pagar = (tenantId: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/admin/billing/tenants/${tenantId}/payments`)
      .set("Authorization", bearer(admin.token))
      .send({
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "499.00",
        ...body,
      });

  const crearProducto = (token: string) =>
    request(app.getHttpServer())
      .post("/products")
      .set("Authorization", bearer(token))
      .send({
        sku: `GRACE-${randomUUID().slice(0, 8)}`,
        name: "Producto de prueba",
        baseUnit: "unit",
        price: 10,
      });

  const suscripcionDe = (tenantId: string) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
    );

  /**
   * Adelanta el calendario moviendo la fecha, no el estado: lo que degrada
   * sigue siendo el barrido. `dueInstant` construye el límite ABIERTO (el
   * arranque del día siguiente) igual que lo haría un cobro real.
   */
  const vencerEl = (tenantId: string, diasAtras: number) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          dueAt: dueInstant(localCalendarDate(TZ, new Date(Date.now() - diasAtras * DIA_MS)), TZ),
          servicePeriodEnd: dueInstant(
            localCalendarDate(TZ, new Date(Date.now() - diasAtras * DIA_MS)),
            TZ,
          ),
        },
      }),
    );

  /** Un negocio al corriente cuyo vencimiento quedó ayer. */
  async function negocioVencidoAyer() {
    const negocio = await registerTenant(app, "grace");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await pagar(negocio.tenantId).expect(201);
    await vencerEl(negocio.tenantId, 1);
    return negocio;
  }

  describe("día 1 al 10: la gracia", () => {
    it("el vencimiento abre 10 días de gracia, y el negocio sigue operando completo", async () => {
      const negocio = await negocioVencidoAyer();

      await correrBarrido().expect(201);

      const sub = await suscripcionDe(negocio.tenantId);
      expect(sub.status).toBe("past_due");
      expect(sub.plan.code).toBe("plus");
      expect(sub.graceEndsAt).not.toBeNull();

      const me = await request(app.getHttpServer())
        .get("/me")
        .set("Authorization", bearer(negocio.token))
        .expect(200);
      expect((me.body as { subscription: Record<string, unknown> }).subscription).toMatchObject({
        status: "past_due",
        planCode: "plus",
        // La clave del tier: past_due CONSERVA el plan. Se avisa, no se corta.
        writeAccess: true,
        stockControl: true,
      });

      // Y escribir funciona de verdad, no solo en el bloque que dice que sí.
      await crearProducto(negocio.token).expect(201);
    });

    it("la gracia dura 10 días contados desde la fecha del vencimiento", async () => {
      const negocio = await negocioVencidoAyer();

      await correrBarrido().expect(201);

      const sub = await suscripcionDe(negocio.tenantId);
      const ultimoDiaDeGracia = localCalendarDate(
        TZ,
        new Date((sub.graceEndsAt as Date).getTime() - 1),
      );
      const ayer = localCalendarDate(TZ, new Date(Date.now() - DIA_MS));
      const esperado = new Date(`${ayer}T12:00:00Z`);
      esperado.setUTCDate(esperado.getUTCDate() + 10);
      expect(ultimoDiaDeGracia).toBe(esperado.toISOString().slice(0, 10));
    });

    it("el aviso de impago sale una sola vez, aunque el barrido corra de nuevo", async () => {
      const negocio = await negocioVencidoAyer();
      const mailer = app.get<NoopMailer>(MAILER);

      await correrBarrido().expect(201);
      await correrBarrido().expect(201);

      const avisos = mailer.sent.filter(
        (m) => m.to === negocio.email && m.template === "payment-past-due",
      );
      expect(avisos).toHaveLength(1);
    });
  });

  describe("día 11: se acabó la gracia", () => {
    it("con la gracia vencida cae a free y deja de escribir", async () => {
      const negocio = await negocioVencidoAyer();
      await correrBarrido().expect(201);

      // Pasaron los diez días.
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.tenantSubscription.update({
          where: { tenantId: negocio.tenantId },
          data: { graceEndsAt: new Date(Date.now() - DIA_MS) },
        }),
      );
      await correrBarrido().expect(201);

      const sub = await suscripcionDe(negocio.tenantId);
      expect(sub.status).toBe("free");
      // El PLAN contratado no se borra: la suscripción recuerda a qué volver.
      expect(sub.plan.code).toBe("plus");

      await crearProducto(negocio.token).expect(402);
    });

    /** La regla de oro: el barrido NUNCA promueve. */
    it("correr el barrido sobre un free no lo devuelve a active", async () => {
      const negocio = await negocioVencidoAyer();
      await correrBarrido().expect(201);
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.tenantSubscription.update({
          where: { tenantId: negocio.tenantId },
          data: { graceEndsAt: new Date(Date.now() - DIA_MS) },
        }),
      );
      await correrBarrido().expect(201);

      await correrBarrido().expect(201);
      await correrBarrido().expect(201);

      expect((await suscripcionDe(negocio.tenantId)).status).toBe("free");
    });
  });

  describe("día 12: el pago tardío", () => {
    /**
     * El que paga tarde arranca período NUEVO desde el día del pago. Ni se le
     * cobran los días muertos (no usó el sistema) ni se le acreditan (no los
     * pagó): el ancla se re-fija y la cuenta vuelve a correr limpia.
     */
    it("reactiva en active, re-ancla al día del pago y no arrastra el período viejo", async () => {
      const negocio = await negocioVencidoAyer();
      await correrBarrido().expect(201);
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.tenantSubscription.update({
          where: { tenantId: negocio.tenantId },
          data: { graceEndsAt: new Date(Date.now() - DIA_MS) },
        }),
      );
      await correrBarrido().expect(201);
      const vencida = await suscripcionDe(negocio.tenantId);

      const ahora = new Date();
      await pagar(negocio.tenantId, { paidAt: ahora.toISOString() }).expect(201);

      const sub = await suscripcionDe(negocio.tenantId);
      expect(sub.status).toBe("active");
      expect(sub.graceEndsAt).toBeNull();
      // El período nuevo arranca en el pago, NO donde terminó el anterior.
      expect(sub.servicePeriodStart?.toISOString()).toBe(ahora.toISOString());
      expect(sub.servicePeriodStart?.getTime()).toBeGreaterThan(
        (vencida.servicePeriodEnd as Date).getTime(),
      );
      // Y el ancla es la del día del pago: su fecha de cobro cambió.
      expect(sub.anchorDay).toBe(Number(localCalendarDate(TZ, ahora).slice(8, 10)));

      await crearProducto(negocio.token).expect(201);
    });
  });

  describe("cancelar es distinto de no pagar", () => {
    /**
     * Cancelar NO corta: deja `cancel_at_period_end` y el status intacto —el
     * servicio pagado se respeta hasta el corte—, y al vencer el barrido lo
     * lleva a `canceled` sin pasar por la gracia. No hay nada que cobrar a
     * quien ya se despidió.
     */
    it("el que canceló se va a canceled al vencer, sin gracia", async () => {
      const negocio = await negocioVencidoAyer();
      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocio.tenantId}/cancel`)
        .set("Authorization", bearer(admin.token))
        .send({ reason: "el cliente cerró el negocio" })
        .expect(201);

      // Cancelar por sí solo no degrada a nadie.
      expect((await suscripcionDe(negocio.tenantId)).status).toBe("active");

      await correrBarrido().expect(201);

      const sub = await suscripcionDe(negocio.tenantId);
      expect(sub.status).toBe("canceled");
      expect(sub.graceEndsAt).toBeNull();
      await crearProducto(negocio.token).expect(402);
    });
  });
});
