import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
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

/**
 * F7-E2E-05 — el cupón: Plus $499 con −$200 durante 12 meses.
 *
 * ── Para qué existe ─────────────────────────────────────────────────────
 *
 * Es la herramienta comercial de Carlos para cerrar clientes: un precio
 * especial POR TIEMPO, no para siempre. Un descuento sin vigencia es una
 * lista de precios paralela que nadie recuerda haber creado; uno con
 * `max_periods` se apaga solo, y el mes 13 el cliente paga la tarifa de
 * lista sin que nadie tenga que acordarse de quitarlo.
 *
 * Por eso hay UN solo cupón activo por negocio (UNIQUE parcial en la base):
 * los descuentos no se apilan. Otorgar uno nuevo obliga a revocar el vigente
 * — una decisión explícita, no una suma silenciosa.
 *
 * Y el pago guarda el SNAPSHOT completo (bruto, descuento y neto): la
 * historia dice cuánto se cobró Y por qué se cobró menos.
 */
describe("Cupones con vigencia (F7-E2E-05)", () => {
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

    admin = await registerTenant(app, "discount-admin");
    await makePlatformAdmin(app, prisma, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  const otorgar = (tenantId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/admin/billing/tenants/${tenantId}/discounts`)
      .set("Authorization", bearer(admin.token))
      .send(body);

  const pagar = (tenantId: string) =>
    request(app.getHttpServer())
      .post(`/admin/billing/tenants/${tenantId}/payments`)
      .set("Authorization", bearer(admin.token))
      .send({ billingCycle: "monthly", method: "transfer", paidAt: new Date().toISOString() });

  const cupones = (tenantId: string) =>
    prisma.withTenantContext(tenantId, (tx) => tx.tenantDiscount.findMany({ where: { tenantId } }));

  async function negocioConCupon(body: Record<string, unknown>) {
    const negocio = await registerTenant(app, "discount");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await otorgar(negocio.tenantId, {
      startsAt: new Date().toISOString(),
      reason: "promoción de lanzamiento",
      ...body,
    }).expect(201);
    return negocio;
  }

  describe("−$200 durante 12 meses", () => {
    it("los doce primeros pagos cobran 299 y el treceavo vuelve a 499", async () => {
      const negocio = await negocioConCupon({
        kind: "fixed_amount",
        amount: "200",
        maxPeriods: 12,
      });

      const cobrados: string[] = [];
      for (let i = 0; i < 13; i += 1) {
        const pago = await pagar(negocio.tenantId).expect(201);
        cobrados.push((pago.body as { amount: string }).amount);
      }

      expect(cobrados.slice(0, 12)).toEqual(Array(12).fill("299"));
      expect(cobrados[12]).toBe("499");

      // El cupón se agotó solo: nadie tuvo que acordarse de quitarlo.
      const [cupon] = await cupones(negocio.tenantId);
      expect(cupon?.appliedPeriods).toBe(12);
      expect(cupon?.maxPeriods).toBe(12);
    });

    it("el pago guarda el desglose: bruto 499, descuento 200, neto 299", async () => {
      const negocio = await negocioConCupon({
        kind: "fixed_amount",
        amount: "200",
        maxPeriods: 12,
      });

      const pago = await pagar(negocio.tenantId).expect(201);

      expect(pago.body).toMatchObject({
        grossAmount: "499",
        discountAmount: "200",
        amount: "299",
        currency: "MXN",
      });
      // Y el pago apunta al cupón que lo explica.
      const [cupon] = await cupones(negocio.tenantId);
      expect((pago.body as { discountId: string }).discountId).toBe(cupon?.id);
    });
  });

  describe("el cupón que regala el período", () => {
    it("`free` cobra 0 y el pago queda registrado igual", async () => {
      const negocio = await negocioConCupon({ kind: "free", maxPeriods: 2 });

      const primero = await pagar(negocio.tenantId).expect(201);
      expect(primero.body).toMatchObject({
        grossAmount: "499",
        discountAmount: "499",
        amount: "0",
      });

      // El servicio corre igual: gratis no es "sin suscripción".
      const sub = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId: negocio.tenantId } }),
      );
      expect(sub.status).toBe("active");
      expect(sub.dueAt).not.toBeNull();
    });
  });

  describe("un solo cupón activo por negocio", () => {
    it("otorgar un segundo cupón sin revocar el vigente responde 409", async () => {
      const negocio = await negocioConCupon({
        kind: "fixed_amount",
        amount: "200",
        maxPeriods: 12,
      });

      const rechazo = await otorgar(negocio.tenantId, {
        kind: "fixed_amount",
        amount: "100",
        startsAt: new Date().toISOString(),
        reason: "otro más",
      }).expect(409);

      expect(rechazo.body).toMatchObject({ code: "billing.discount_overlap" });
    });

    it("revocado el vigente, el siguiente pago cobra la tarifa completa", async () => {
      const negocio = await negocioConCupon({
        kind: "fixed_amount",
        amount: "200",
        maxPeriods: 12,
      });
      const [cupon] = await cupones(negocio.tenantId);

      expect((await pagar(negocio.tenantId).expect(201)).body).toMatchObject({ amount: "299" });

      await request(app.getHttpServer())
        .delete(`/admin/billing/tenants/${negocio.tenantId}/discounts/${cupon?.id}`)
        .set("Authorization", bearer(admin.token))
        .send({ reason: "terminó la promoción" })
        .expect(200);

      expect((await pagar(negocio.tenantId).expect(201)).body).toMatchObject({ amount: "499" });
    });
  });

  describe("la vigencia manda", () => {
    it("un cupón que arranca mañana no se aplica hoy", async () => {
      const negocio = await negocioConCupon({
        kind: "fixed_amount",
        amount: "200",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        maxPeriods: 12,
      });

      expect((await pagar(negocio.tenantId).expect(201)).body).toMatchObject({ amount: "499" });
    });

    it("un cupón que ya venció tampoco", async () => {
      const negocio = await negocioConCupon({
        kind: "fixed_amount",
        amount: "200",
        startsAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() - 86_400_000).toISOString(),
      });

      expect((await pagar(negocio.tenantId).expect(201)).body).toMatchObject({ amount: "499" });
    });
  });
});
