import { randomUUID } from "node:crypto";
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
 * F9-ADMIN-12 — el expediente del negocio, de punta a punta.
 *
 * Lo que fija:
 *  - la puerta: un TenantAdmin normal recibe 403 en todas las rutas;
 *  - el admin sobre el negocio B ve SOLO datos de B: resumen, usuarios,
 *    dashboard y reportes, con el actor sintético y alcance total;
 *  - suspender desde el backoffice audita en B con el userId del admin, y la
 *    invariante del último admin activo sigue mandando (409);
 *  - las exportaciones bajan un archivo del negocio de la URL (F9-ADMIN-13).
 */
describe("Expediente del negocio (F9-ADMIN-12)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocioB: TenantFixture;
  let invitadoId: string;

  const ruta = (sufijo: string) => `/admin/tenants/${negocioB.tenantId}/${sufijo}`;
  const comoAdmin = (sufijo: string) =>
    request(app.getHttpServer()).get(ruta(sufijo)).set("Authorization", bearer(admin.token));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "expediente-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocioB = await registerTenant(app, "expediente-b");
    await setTenantMarket(prisma, negocioB.tenantId, "MX");

    // B tiene un producto con stock y una venta de hoy: el material del
    // dashboard y de los reportes.
    const producto = await crearProducto(app, negocioB.token, 30);
    const almacen = await almacenInicial(prisma, negocioB.tenantId);
    await cargarStock(app, negocioB.token, almacen, producto.id, 10);
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(negocioB.token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post("/pos/sales")
      .set("Authorization", bearer(negocioB.token))
      .send({ paymentMethod: "cash", lines: [{ productId: producto.id, quantity: 1 }] })
      .expect(201);

    // Y un usuario invitado, para suspenderlo desde el backoffice.
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(negocioB.token))
      .expect(200);
    const viewer = (roles.body as { id: string; name: string }[]).find((r) => r.name === "Viewer");
    const invitado = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(negocioB.token))
      .send({
        email: `expediente-viewer-${randomUUID()}@example.com`,
        firstName: "Vera",
        lastNamePaternal: "Vista",
        roleIds: [viewer?.id],
      })
      .expect(201);
    invitadoId = (invitado.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("un TenantAdmin normal recibe 403 en todas las rutas del expediente, no 402", async () => {
    for (const sufijo of [
      "overview",
      "users",
      "dashboard/kpis",
      "dashboard/series",
      "dashboard/products?period=month",
      "dashboard/inventory",
      "dashboard/payment-methods?period=month",
      "reports/sales",
      "reports/stock",
      "reports/sales/export?format=xlsx",
    ]) {
      await request(app.getHttpServer())
        .get(ruta(sufijo))
        .set("Authorization", bearer(negocioB.token))
        .expect(403);
    }
    await request(app.getHttpServer())
      .post(ruta(`users/${invitadoId}/suspend`))
      .set("Authorization", bearer(negocioB.token))
      .expect(403);
  });

  it("el resumen trae los conteos y el plan de B", async () => {
    const res = await comoAdmin("overview").expect(200);
    const body = res.body as {
      tenant: { name: string; currency: string };
      users: { active: number; invited: number; suspended: number };
      counts: { products: number; services: number; subcatalogs: number; warehouses: number };
      subscription: { planCode: string; status: string };
      modules: string[];
    };
    expect(body.tenant.currency).toBe("MXN");
    expect(body.users).toEqual({ active: 1, invited: 1, suspended: 0 });
    expect(body.counts.products).toBe(1);
    expect(body.counts.warehouses).toBeGreaterThanOrEqual(1);
    expect(body.subscription).toMatchObject({ planCode: "plus", status: "trialing" });
    expect(body.modules).toEqual([]);
  });

  it("lista los usuarios de B y suspende al invitado: el audit de B lleva el userId del admin", async () => {
    const lista = await comoAdmin("users").expect(200);
    const correos = (lista.body as { email: string }[]).map((u) => u.email);
    expect(correos).toContain(negocioB.email);

    const suspendido = await request(app.getHttpServer())
      .post(ruta(`users/${invitadoId}/suspend`))
      .set("Authorization", bearer(admin.token))
      .expect(200);
    expect((suspendido.body as { status: string }).status).toBe("suspended");

    const rastro = await prisma.withTenantContext(negocioB.tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { action: "user.suspended", resourceId: invitadoId },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(rastro?.userId).toBe(admin.userId);

    const reactivado = await request(app.getHttpServer())
      .post(ruta(`users/${invitadoId}/reactivate`))
      .set("Authorization", bearer(admin.token))
      .expect(200);
    expect((reactivado.body as { status: string }).status).toBe("active");
  });

  it("suspender al ÚNICO admin activo de B rebota con 409 y sigue activo", async () => {
    await request(app.getHttpServer())
      .post(ruta(`users/${negocioB.userId}/suspend`))
      .set("Authorization", bearer(admin.token))
      .expect(409);
    const lista = await comoAdmin("users").expect(200);
    const owner = (lista.body as { id: string; status: string }[]).find(
      (u) => u.id === negocioB.userId,
    );
    expect(owner?.status).toBe("active");
  });

  it("el dashboard es el de B: la venta de hoy y el valor del inventario", async () => {
    const kpis = await comoAdmin("dashboard/kpis").expect(200);
    expect((kpis.body as { today: { tickets: number } }).today.tickets).toBe(1);

    const inventario = await comoAdmin("dashboard/inventory").expect(200);
    // El actor sintético lleva reports:read: el valor del inventario viaja.
    expect((inventario.body as { inventoryValue?: string }).inventoryValue).toBeDefined();

    await comoAdmin("dashboard/series").expect(200);
    await comoAdmin("dashboard/products?period=month").expect(200);
    await comoAdmin("dashboard/payment-methods?period=month").expect(200);
    await comoAdmin("dashboard/products?period=siempre").expect(400);
  });

  it("los reportes de ventas e inventario son los de B, con los mismos filtros", async () => {
    const ventas = await comoAdmin("reports/sales").expect(200);
    const filas = (ventas.body as { rows: { folio: string }[]; total: number }).rows;
    expect(filas).toHaveLength(1);
    expect(filas[0]?.folio).toMatch(/^VTA-/);

    const stock = await comoAdmin("reports/stock").expect(200);
    expect((stock.body as { rows: unknown[] }).rows.length).toBeGreaterThanOrEqual(1);

    await comoAdmin("reports/sales?page=0").expect(400);
  });

  it("las exportaciones bajan un archivo del negocio de la URL (F9-ADMIN-13)", async () => {
    const ventas = await comoAdmin("reports/sales/export?format=xlsx").expect(200);
    expect(ventas.headers["content-type"]).toContain("spreadsheet");
    expect(ventas.headers["content-disposition"]).toContain("attachment");

    const stock = await comoAdmin("reports/stock/export?format=csv").expect(200);
    expect(stock.headers["content-disposition"]).toContain("attachment");
  });
});
