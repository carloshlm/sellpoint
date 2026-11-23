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
    // El turno se cierra descuadrado: el material del reporte de cierres.
    await request(app.getHttpServer())
      .post("/pos/session/close")
      .set("Authorization", bearer(negocioB.token))
      .send({ declaredCash: "20.00", note: "e2e" })
      .expect(200);

    // Y un usuario invitado, para suspenderlo desde el backoffice.
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(negocioB.token))
      .expect(200);
    const viewer = (roles.body as { id: string; systemKey: string | null }[]).find(
      (r) => r.systemKey === "viewer",
    );
    const invitado = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(negocioB.token))
      .send({
        email: `expediente-viewer-${randomUUID()}@example.com`,
        firstName: "Vera",
        lastName: "Vista",
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
      "reports/shifts",
      "reports/shifts/export?format=csv",
      "reports/shifts/00000000-0000-0000-0000-000000000000",
      "reports/shifts/00000000-0000-0000-0000-000000000000/pdf",
      "reports/taxes",
      "reports/taxes/export?format=csv",
      "reports/sales-by-product",
      "reports/sales-by-product/export?format=xlsx",
      "reports/sales-by-service",
      "reports/sales-by-service/export?format=xlsx",
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
    // F10-KPI-05/06: el margen, el cierre estimado y el punto de equilibrio
    // viajan por el espejo. B vendió solo hoy (ningún día cerrado), no tiene
    // meta ni gastos.
    const cuerpo = kpis.body as {
      month: Record<string, unknown>;
      profit: Record<string, unknown>;
    };
    expect(cuerpo.month).toHaveProperty("projected", null);
    expect(cuerpo.month).toHaveProperty("requiredDaily", null);
    expect(cuerpo.profit).toHaveProperty("marginPct");
    expect(cuerpo.profit.breakEven).toEqual({
      expenses: "0.00",
      coveredPct: null,
      coveredOnDay: null,
      remainingSales: null,
    });

    const inventario = await comoAdmin("dashboard/inventory").expect(200);
    // El actor sintético lleva reports:read: el valor del inventario viaja.
    expect((inventario.body as { inventoryValue?: string }).inventoryValue).toBeDefined();

    // F10-KPI-03: la referencia por hora también viaja por el espejo (B vende
    // hoy pero no tiene historia, así que es null en las 24 horas).
    const series = await comoAdmin("dashboard/series").expect(200);
    const porHora = (series.body as { byHour: { reference?: string | null }[] }).byHour;
    expect(porHora).toHaveLength(24);
    for (const hora of porHora) {
      expect(hora).toHaveProperty("reference", null);
    }
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

    // F4-TAX-21: el reporte de impuestos también se lee desde el expediente.
    const impuestos = await comoAdmin("reports/taxes").expect(200);
    expect((impuestos.body as { totals: { tickets: number } }).totals.tickets).toBe(1);
  });

  it("los cierres de turno del negocio se leen y se bajan desde el expediente (F5-SHIFT-05)", async () => {
    // Sin filtro de fecha: el turno de B cerró «hoy», pero el día lo calcula el
    // negocio y este test no quiere depender de la hora en que corre.
    const cierres = await comoAdmin("reports/shifts?status=closed").expect(200);
    const filas = (cierres.body as { rows: { id: string; declaredCash: string | null }[] }).rows;
    expect(filas.length).toBeGreaterThanOrEqual(1);

    const detalle = await comoAdmin(`reports/shifts/${filas[0]?.id}`).expect(200);
    expect((detalle.body as { sales: unknown[] }).sales.length).toBeGreaterThanOrEqual(1);

    await comoAdmin("reports/shifts/00000000-0000-0000-0000-000000000000").expect(404);

    const archivo = await comoAdmin("reports/shifts/export?format=csv").expect(200);
    expect(archivo.headers["content-disposition"]).toContain("cierres-de-turno");

    // Carlos (2026-11-16): el PDF carta del cierre, también desde el expediente.
    const pdf = await comoAdmin(`reports/shifts/${filas[0]?.id}/pdf`).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toMatch(/-TUR-\d{6}\.pdf"$/);
    expect(pdf.headers["content-disposition"]).not.toContain("cierre");
  });

  /**
   * Carlos (2026-11-02): «Ventas por producto» y «Ventas por servicio» también
   * se leen y se bajan desde el expediente, con los filtros del cliente (sin
   * Estado: solo lo cobrado).
   */
  it("las ventas por producto y por servicio son las de B, y se bajan", async () => {
    const productos = await comoAdmin("reports/sales-by-product").expect(200);
    const filas = (productos.body as { rows: { folio: string; quantity: string }[] }).rows;
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ folio: expect.stringMatching(/^VTA-/), quantity: "1" });

    const servicios = await comoAdmin("reports/sales-by-service").expect(200);
    expect((servicios.body as { rows: unknown[] }).rows).toHaveLength(0);

    await comoAdmin("reports/sales-by-product?status=completed").expect(400);

    const archivo = await comoAdmin("reports/sales-by-product/export?format=xlsx").expect(200);
    expect(archivo.headers["content-disposition"]).toContain("ventas-por-producto");
    const otro = await comoAdmin("reports/sales-by-service/export?format=csv").expect(200);
    expect(otro.headers["content-disposition"]).toContain("ventas-por-servicio");
  });

  /**
   * F10-KPI-11 y F10-KPI-13: el expediente usa los MISMOS DTO, así que los
   * filtros y los campos nuevos de Ventas y de Cierres llegan solos. Sin los
   * filtros nuevos, la respuesta es la de siempre con lo nuevo al final.
   */
  it("el expediente hereda el descuento de Ventas y la diferencia de Cierres", async () => {
    const ventas = await comoAdmin("reports/sales").expect(200);
    const cuerpo = ventas.body as { rows: Record<string, unknown>[] } & Record<string, unknown>;
    expect(Object.keys(cuerpo)).toEqual([
      "rows",
      "totals",
      "total",
      "page",
      "pageSize",
      "discountTotal",
    ]);
    expect(cuerpo.discountTotal).toBe("0.00");
    expect(cuerpo.rows[0]).toMatchObject({
      discount: "0.00",
      discountReason: null,
      cancelReason: null,
      canceledAt: null,
      canceledBy: null,
    });
    // La venta de B no llevó descuento.
    const conDescuento = await comoAdmin("reports/sales?discounted=true").expect(200);
    expect((conDescuento.body as { rows: unknown[] }).rows).toHaveLength(0);
    await comoAdmin("reports/sales/export?format=csv&discounted=true").expect(200);
    // Ventas por producto sigue sin el filtro, como antes.
    await comoAdmin("reports/sales-by-product?discounted=true").expect(400);

    // El turno de B cerró con faltante: contó menos de lo calculado.
    const cierres = await comoAdmin("reports/shifts").expect(200);
    const pie = cierres.body as {
      rows: { id: string; cashDifference: string | null }[];
      differenceTotals: { shortage: string; overage: string };
    };
    expect(Object.keys(pie)).toEqual(["rows", "total", "page", "pageSize", "differenceTotals"]);
    const diferencia = Number(pie.rows[0]?.cashDifference);
    expect(diferencia).toBeLessThan(0);
    expect(pie.differenceTotals).toEqual({ shortage: (-diferencia).toFixed(2), overage: "0.00" });
    const faltante = await comoAdmin("reports/shifts?difference=shortage").expect(200);
    expect((faltante.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
      pie.rows[0]?.id,
    ]);
    const sobrante = await comoAdmin("reports/shifts?difference=overage").expect(200);
    expect((sobrante.body as { rows: unknown[] }).rows).toHaveLength(0);
    await comoAdmin("reports/shifts/export?format=csv&difference=overage").expect(200);
  });

  it("las exportaciones bajan un archivo del negocio de la URL (F9-ADMIN-13)", async () => {
    const ventas = await comoAdmin("reports/sales/export?format=xlsx").expect(200);
    expect(ventas.headers["content-type"]).toContain("spreadsheet");
    expect(ventas.headers["content-disposition"]).toContain("attachment");

    const stock = await comoAdmin("reports/stock/export?format=csv").expect(200);
    expect(stock.headers["content-disposition"]).toContain("attachment");
  });
});
