import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  bearer,
  cargarStock,
  crearProducto,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F7-E2E-02 — el trial que vence y el MODO GRATUITO que queda.
 *
 * ── La decisión de negocio que se prueba acá ────────────────────────────
 *
 * Cuando el trial termina sin pago, la cuenta NO se cierra. Carlos fue
 * explícito: «puede seguir entrando a su cuenta pero no realizar acciones en
 * catálogos, inventario o cotizaciones, sólo se le permitirá realizar 10
 * ventas al día». Es una decisión comercial, no técnica — el negocio que
 * probó y no contrató sigue teniendo sus datos a la vista, y sigue pudiendo
 * cobrar en el mostrador. Lo que pierde es la capacidad de ADMINISTRAR.
 *
 * De ahí las tres verificaciones que dan forma al tier: leer siempre (200),
 * escribir nunca (402 `billing.read_only`), vender hasta diez (la 11ª es 402
 * `billing.daily_sales_limit_reached`).
 *
 * El límite se cuenta por día del NEGOCIO —no por bloques de 24 horas— y las
 * ventas canceladas devuelven el cupo: cancelar corrige un error, y castigar
 * el error sería cobrar dos veces por la misma venta.
 */
describe("Trial vencido → modo gratuito (F7-E2E-02)", () => {
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

    admin = await registerTenant(app, "freetier-admin");
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

  const vender = (token: string, productId: string) =>
    request(app.getHttpServer())
      .post("/pos/sales")
      .set("Authorization", bearer(token))
      .send({ paymentMethod: "cash", lines: [{ productId, quantity: 1 }] });

  /**
   * El negocio que probó 14 días y no contrató: con su catálogo cargado, su
   * stock y su caja abierta — todo eso hecho MIENTRAS el trial valía.
   */
  async function negocioConTrialVencido() {
    const negocio = await registerTenant(app, "freetier");
    await setTenantMarket(prisma, negocio.tenantId, "MX");

    const almacen = await almacenInicial(prisma, negocio.tenantId);
    const producto = await crearProducto(app, negocio.token, 20);
    await cargarStock(app, negocio.token, almacen, producto.id, 100);
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(negocio.token))
      .send({})
      .expect(201);

    // El calendario avanza: el trial venció ayer. Lo que sigue es el CRON
    // haciendo su trabajo, no una escritura directa del estado.
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.tenantSubscription.update({
        where: { tenantId: negocio.tenantId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      }),
    );
    await correrBarrido().expect(201);

    return { ...negocio, productId: producto.id };
  }

  describe("el barrido degrada, y el plan efectivo lo refleja", () => {
    it("el trial vencido cae a free: sin escritura, con 10 ventas al día", async () => {
      const negocio = await negocioConTrialVencido();

      const me = await request(app.getHttpServer())
        .get("/me")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect((me.body as { subscription: Record<string, unknown> }).subscription).toMatchObject({
        planCode: "free",
        status: "free",
        writeAccess: false,
        stockControl: false,
        dailySalesLimit: 10,
      });
    });

    /** Correr el barrido dos veces no degrada dos veces ni avisa dos veces. */
    it("el barrido es idempotente: la segunda pasada no mueve nada", async () => {
      const negocio = await negocioConTrialVencido();
      const mailer = app.get<NoopMailer>(MAILER);
      const avisosAntes = mailer.sent.filter(
        (m) => m.to === negocio.email && m.template === "trial-ended",
      ).length;

      await correrBarrido().expect(201);

      const avisosDespues = mailer.sent.filter(
        (m) => m.to === negocio.email && m.template === "trial-ended",
      ).length;
      expect(avisosAntes).toBe(1);
      expect(avisosDespues).toBe(1);
    });
  });

  describe("ver todo, escribir nada", () => {
    it("GET /products responde 200: el free tier conserva sus datos a la vista", async () => {
      const negocio = await negocioConTrialVencido();

      const listado = await request(app.getHttpServer())
        .get("/products")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect((listado.body as { total: number }).total).toBe(1);
    });

    it("POST /products responde 402 billing.read_only, no 403", async () => {
      const negocio = await negocioConTrialVencido();

      const rechazo = await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(negocio.token))
        .send({ sku: "NUEVO-1", name: "Otro producto", baseUnit: "unit", price: 10 })
        .expect(402);

      // El 403 queda reservado para los permisos (tu ROL no puede). Este
      // usuario ES el Admin del negocio: lo que falta es PLAN, no permiso.
      expect(rechazo.body).toMatchObject({ code: "billing.read_only" });
      expect((rechazo.body as { message: string }).message).toContain("modo gratuito");
    });

    it("tampoco puede editar el inventario ni el catálogo de servicios", async () => {
      const negocio = await negocioConTrialVencido();
      const almacen = await almacenInicial(prisma, negocio.tenantId);

      await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(negocio.token))
        .send({ type: "entry", warehouseId: almacen })
        .expect(402);

      await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(negocio.token))
        .send({ code: "SERV-1", name: "Consulta", price: 100, warehouseIds: [] })
        .expect(402);
    });
  });

  describe("las 10 ventas del día", () => {
    it("vende diez, y la número once responde 402 con el límite dicho", async () => {
      const negocio = await negocioConTrialVencido();

      for (let i = 0; i < 10; i += 1) {
        await vender(negocio.token, negocio.productId).expect(201);
      }

      const rechazo = await vender(negocio.token, negocio.productId).expect(402);
      expect(rechazo.body).toMatchObject({ code: "billing.daily_sales_limit_reached" });
      // El límite viaja DICHO en el mensaje: "alcanzaste las 10 ventas de hoy".
      expect((rechazo.body as { message: string }).message).toContain("10 ventas");

      // Y el rechazo NO gastó folio: la venta 11 no existe ni como hueco.
      const ventas = await prisma.withTenantContext(negocio.tenantId, (tx) => tx.sale.count());
      expect(ventas).toBe(10);
    });

    /**
     * Cancelar devuelve el cupo. Un mostrador que se equivoca al cobrar no
     * puede quedarse sin poder vender el resto del día por corregirlo.
     */
    it("una venta cancelada libera su lugar", async () => {
      const negocio = await negocioConTrialVencido();

      const primera = await vender(negocio.token, negocio.productId).expect(201);
      for (let i = 0; i < 9; i += 1) {
        await vender(negocio.token, negocio.productId).expect(201);
      }
      await vender(negocio.token, negocio.productId).expect(402);

      await request(app.getHttpServer())
        .post(`/pos/sales/${(primera.body as { id: string }).id}/cancel`)
        .set("Authorization", bearer(negocio.token))
        .send({ reason: "cobro equivocado" })
        .expect(200);

      await vender(negocio.token, negocio.productId).expect(201);
    });

    /** Un plan de pago no cuenta nada: `daily_sales_limit` NULL = sin límite. */
    it("el mismo negocio, ya pagando, vende sin tope", async () => {
      const negocio = await negocioConTrialVencido();
      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocio.tenantId}/payments`)
        .set("Authorization", bearer(admin.token))
        .send({
          billingCycle: "monthly",
          method: "transfer",
          paidAt: new Date().toISOString(),
          amountReceived: "499.00",
        })
        .expect(201);

      for (let i = 0; i < 11; i += 1) {
        await vender(negocio.token, negocio.productId).expect(201);
      }
    });
  });
});
