import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
 * F7-E2E-06 — el aislamiento del backoffice.
 *
 * ── El problema que resuelve, y su costo ────────────────────────────────
 *
 * Todo el sistema vive bajo RLS: una fila solo se ve desde el contexto de su
 * tenant. Pero el dueño de la plataforma necesita ver a TODOS los negocios a
 * la vez para cobrar — y esa necesidad es exactamente la forma de un agujero
 * en el aislamiento multi-tenant.
 *
 * La respuesta fue un bypass ACOTADO: la policy `billing_admin_bypass` existe
 * únicamente en las cuatro tablas de billing. Desde el contexto del dueño se
 * leen suscripciones, pagos, descuentos y avisos de todos los negocios; una
 * consulta a `sales`, `products` o cualquier otra tabla desde ESE MISMO
 * contexto devuelve CERO filas. No es una convención del código: lo impone
 * Postgres, y por eso hace falta un test que lo compruebe contra la base de
 * verdad.
 *
 * ── Y la puerta de entrada ──────────────────────────────────────────────
 *
 * No existe SuperAdmin —los roles son POR tenant—, así que el plano de
 * administración se abre con cuatro llaves en AND: el flag en la fila, el
 * email en la whitelist del entorno, la cuenta activa y el email verificado.
 * Dos llaves de fondo (flag + whitelist) para que ninguna falla baste sola:
 * un UPDATE malicioso al flag no sirve sin la whitelist, y un email colado en
 * la whitelist no sirve sin el flag.
 */
describe("Aislamiento del backoffice (F7-E2E-06)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocioA: TenantFixture;
  let negocioB: TenantFixture;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "isolation-admin");
    await makePlatformAdmin(app, prisma, admin);

    // Dos negocios ajenos entre sí. El primero además VENDE: la venta es la
    // fila que el bypass no puede alcanzar.
    negocioA = await registerTenant(app, "isolation-a");
    negocioB = await registerTenant(app, "isolation-b");
    await setTenantMarket(prisma, negocioA.tenantId, "MX");
    await setTenantMarket(prisma, negocioB.tenantId, "CA");

    const producto = await crearProducto(app, negocioA.token, 30);
    const almacen = await almacenInicial(prisma, negocioA.tenantId);
    await cargarStock(app, negocioA.token, almacen, producto.id, 10);
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(negocioA.token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post("/pos/sales")
      .set("Authorization", bearer(negocioA.token))
      .send({ paymentMethod: "cash", lines: [{ productId: producto.id, quantity: 1 }] })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("el bypass llega a billing y no un centímetro más", () => {
    it("desde el contexto del dueño se leen las suscripciones de los dos negocios", async () => {
      const suscripciones = await prisma.withBillingAdminContext((tx) =>
        tx.tenantSubscription.findMany({
          where: { tenantId: { in: [negocioA.tenantId, negocioB.tenantId] } },
          select: { tenantId: true },
        }),
      );

      expect(suscripciones.map((s) => s.tenantId).sort()).toEqual(
        [negocioA.tenantId, negocioB.tenantId].sort(),
      );
    });

    /**
     * El test que da sentido a todo el archivo. Si esto devolviera 1, el
     * bypass sería un agujero: el dueño de la plataforma podría leer las
     * ventas —y los precios, y los clientes— de cualquier negocio.
     */
    it("desde ESE MISMO contexto, las ventas de un negocio ajeno son CERO filas", async () => {
      const { ventas, productos, usuarios } = await prisma.withBillingAdminContext(async (tx) => ({
        ventas: await tx.sale.count(),
        productos: await tx.product.count(),
        usuarios: await tx.user.count(),
      }));

      expect(ventas).toBe(0);
      expect(productos).toBe(0);
      expect(usuarios).toBe(0);

      // Y la venta EXISTE: el cero de arriba es aislamiento, no una base vacía.
      const propias = await prisma.withTenantContext(negocioA.tenantId, (tx) => tx.sale.count());
      expect(propias).toBe(1);
    });

    it("la lista del backoffice ve a los dos negocios con su plan", async () => {
      const listado = await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(admin.token))
        .expect(200);

      const filas = (listado.body as { tenants: { tenantId: string; planCode: string }[] }).tenants;
      expect(filas.find((f) => f.tenantId === negocioA.tenantId)?.planCode).toBe("plus");
      expect(filas.find((f) => f.tenantId === negocioB.tenantId)?.planCode).toBe("plus");
    });

    /** El MRR se agrupa por moneda: sumar MXN con CAD daría un número que no existe. */
    it("el MRR llega separado por moneda", async () => {
      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocioA.tenantId}/payments`)
        .set("Authorization", bearer(admin.token))
        .send({ billingCycle: "monthly", method: "transfer", paidAt: new Date().toISOString() })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocioB.tenantId}/payments`)
        .set("Authorization", bearer(admin.token))
        .send({ billingCycle: "monthly", method: "transfer", paidAt: new Date().toISOString() })
        .expect(201);

      const listado = await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(admin.token))
        .expect(200);

      const mrr = (listado.body as { mrrByCurrency: Record<string, string> }).mrrByCurrency;
      // Otras corridas dejan negocios en la misma base: lo que se fija es que
      // CADA moneda existe por separado y que la de cada uno está incluida.
      expect(Number(mrr.MXN)).toBeGreaterThanOrEqual(499);
      expect(Number(mrr.CAD)).toBeGreaterThanOrEqual(59);
    });
  });

  describe("las cuatro llaves de la puerta", () => {
    it("el dueño de un negocio cualquiera recibe 403, no 402", async () => {
      const rechazo = await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(negocioA.token))
        .expect(403);

      expect(rechazo.body).toMatchObject({ code: "billing.not_platform_admin" });
    });

    it("sin token, 401: el backoffice no se asoma sin sesión", async () => {
      await request(app.getHttpServer()).get("/admin/billing/tenants").expect(401);
    });

    /**
     * La whitelist sola no alcanza. Este usuario está en el entorno pero no
     * tiene el flag: un email colado en la variable no abre nada.
     */
    it("en la whitelist pero sin el flag: 403", async () => {
      const config = app.get(ConfigService);
      config.set("BILLING_ADMIN_EMAILS", `${admin.email},${negocioB.email}`);

      await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(negocioB.token))
        .expect(403);

      // El dueño de verdad sigue entrando: la whitelist admite varios.
      await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(admin.token))
        .expect(200);

      config.set("BILLING_ADMIN_EMAILS", admin.email);
    });

    /**
     * Y el flag solo tampoco. Es la mitad que protege del UPDATE malicioso:
     * escribir `is_platform_admin = true` en la base no sirve de nada si el
     * email no está en una variable de entorno que vive fuera de la base.
     */
    it("con el flag pero fuera de la whitelist: 403", async () => {
      const intruso = await registerTenant(app, "isolation-intruso");
      await prisma.withTenantContext(intruso.tenantId, (tx) =>
        tx.user.update({ where: { id: intruso.userId }, data: { isPlatformAdmin: true } }),
      );

      await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(intruso.token))
        .expect(403);
    });

    /** Suspender la cuenta cierra la puerta aunque el flag y la whitelist sigan. */
    it("el admin suspendido pierde el backoffice", async () => {
      const config = app.get(ConfigService);
      const suspendido = await registerTenant(app, "isolation-suspendido");
      await makePlatformAdmin(app, prisma, suspendido);

      await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(suspendido.token))
        .expect(200);

      await prisma.withTenantContext(suspendido.tenantId, (tx) =>
        tx.user.update({ where: { id: suspendido.userId }, data: { status: "suspended" } }),
      );

      await request(app.getHttpServer())
        .get("/admin/billing/tenants")
        .set("Authorization", bearer(suspendido.token))
        .expect(403);

      config.set("BILLING_ADMIN_EMAILS", admin.email);
    });
  });

  describe("los datos de un negocio los ve su propio dueño", () => {
    it("GET /billing/me devuelve SOLO el historial propio", async () => {
      const propio = await request(app.getHttpServer())
        .get("/billing/me")
        .set("Authorization", bearer(negocioA.token))
        .expect(200);

      const body = propio.body as {
        subscription: { tenantId: string };
        payments: { tenantId: string }[];
      };
      expect(body.subscription.tenantId).toBe(negocioA.tenantId);
      expect(body.payments.every((p) => p.tenantId === negocioA.tenantId)).toBe(true);
    });
  });
});
