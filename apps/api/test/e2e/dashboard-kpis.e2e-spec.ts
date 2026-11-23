import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F5-DASH-03 — el cableado HTTP del endpoint de KPIs.
 *
 * La MATEMÁTICA (día local, corridos, utilidad, alcance) vive en el spec de
 * integración con reloj falso — acá se prueba lo que solo el HTTP puede
 * probar: la puerta del permiso y que la forma real viaja completa.
 */
describe("GET /reports/dashboard/kpis (F5-DASH-03)", () => {
  let app: INestApplication<App>;
  let tokenService: TokenService;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function ownerToken(): Promise<{ token: string; tenantId: string }> {
    const email = `kpi-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant kpi ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastName: "Pérez",
        locale: "es",
      })
      .expect(201);
    const mailer = app.get<NoopMailer>(MAILER);
    const link = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token: link }).expect(200);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);
    const body = login.body as { accessToken: string };
    const payload = JSON.parse(
      Buffer.from(body.accessToken.split(".")[1] as string, "base64").toString(),
    ) as { tenantId: string };
    return { token: body.accessToken, tenantId: payload.tenantId };
  }

  it("con reports:read responde la forma completa — un negocio nuevo, en ceros y nulls", async () => {
    const { token } = await ownerToken();

    const res = await request(app.getHttpServer())
      .get("/reports/dashboard/kpis")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      today: { total: "0", tickets: 0, averageTicket: null, deltaVsLastWeekPct: null },
      // F10-KPI-05: sin ninguna venta no hay cierre estimado; sin meta, no hay ritmo.
      month: {
        total: "0",
        deltaVsPrevMonthPct: null,
        goal: null,
        goalPct: null,
        projected: null,
        requiredDaily: null,
      },
      // F9-EXP-11: la neta viaja junto a la bruta; sin bruta, las dos son null.
      // F10-KPI-05/06: sin utilidad no hay margen; sin gastos, no hay avance.
      profit: {
        month: null,
        deltaVsPrevMonthPct: null,
        netMonth: null,
        netDeltaVsPrevMonthPct: null,
        marginPct: null,
        breakEven: { expenses: "0.00", coveredPct: null, coveredOnDay: null, remainingSales: null },
      },
      // F10-KPI-16: sin gastos por pagar ni turnos con faltante, ceros de verdad.
      attention: {
        payables: {
          overdueCount: 0,
          overdueAmount: "0.00",
          dueSoonCount: 0,
          dueSoonAmount: "0.00",
        },
        shiftShortages: {
          count: 0,
          amount: "0.00",
          range: { from: expect.any(String), to: expect.any(String) },
        },
      },
    });
  });

  it("los widgets responden sus formas vacías y cada puerta exige su permiso (F5-DASH-04..07)", async () => {
    const { token, tenantId } = await ownerToken();

    const series = await request(app.getHttpServer())
      .get("/reports/dashboard/series")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cuerpoSeries = series.body as {
      byDay: unknown[];
      byHour: { hour: number; total: string; reference: string | null }[];
    };
    expect(cuerpoSeries.byDay.length).toBeGreaterThanOrEqual(28);
    expect(cuerpoSeries.byHour).toHaveLength(24);
    // F10-KPI-03: un negocio sin historia no tiene referencia; viaja null, no "0".
    for (const hora of cuerpoSeries.byHour) {
      expect(hora).toHaveProperty("reference", null);
    }

    const products = await request(app.getHttpServer())
      .get("/reports/dashboard/products?period=week")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(products.body).toEqual({
      topSold: [],
      topProfit: [],
      belowCost: [],
      belowCostCount: 0,
      uncosted: [],
      uncostedCount: 0,
    });

    const payments = await request(app.getHttpServer())
      .get("/reports/dashboard/payment-methods")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(payments.body).toEqual({ methods: [] });

    // Un período fuera del catálogo no pasa del pipe.
    await request(app.getHttpServer())
      .get("/reports/dashboard/products?period=ayer")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);

    // El widget de INVENTARIO es de quien opera el almacén: entra con
    // inventory:read… pero el VALOR (dinero) se omite sin reports:read.
    const almacenero = tokenService.signAccessToken({
      sub: randomUUID(),
      tenantId,
      permissions: ["inventory:read"],
      locale: "es",
    });
    const inventario = await request(app.getHttpServer())
      .get("/reports/dashboard/inventory")
      .set("Authorization", `Bearer ${almacenero}`)
      .expect(200);
    expect(inventario.body).toEqual({ outOfStock: 0, belowMin: 0, attention: [] });
    expect(inventario.body).not.toHaveProperty("inventoryValue");

    const duenio = await request(app.getHttpServer())
      .get("/reports/dashboard/inventory")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(duenio.body).toHaveProperty("inventoryValue");

    // Y las puertas: el vendedor no entra a las series; el almacenero
    // tampoco a los números de venta.
    const vendedor = tokenService.signAccessToken({
      sub: randomUUID(),
      tenantId,
      permissions: ["pos:sell"],
      locale: "es",
    });
    await request(app.getHttpServer())
      .get("/reports/dashboard/series")
      .set("Authorization", `Bearer ${vendedor}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/reports/dashboard/inventory")
      .set("Authorization", `Bearer ${vendedor}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/reports/dashboard/products")
      .set("Authorization", `Bearer ${almacenero}`)
      .expect(403);
  });

  /**
   * F10-KPI-14 — «Control» es dinero: los faltantes, los descuentos y las
   * cancelaciones viajan solo con `reports:read`. La matemática vive en
   * `dashboard-control.integration.spec.ts`.
   */
  it("Control responde su forma vacía con el periodo, y sin reports:read -> 403", async () => {
    const { token, tenantId } = await ownerToken();

    const control = await request(app.getHttpServer())
      .get("/reports/dashboard/control?period=week")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cuerpo = control.body as { range: { from: string; to: string } };
    expect(cuerpo).toEqual({
      cash: {
        shortage: { amount: "0.00", shifts: 0 },
        overage: { amount: "0.00", shifts: 0 },
        closedShifts: 0,
      },
      discounts: { amount: "0.00", tickets: 0, pctOfSales: null },
      cancellations: { count: 0, amount: "0.00" },
      range: { from: expect.any(String), to: expect.any(String) },
    });
    expect(cuerpo.range.from <= cuerpo.range.to).toBe(true);

    // Sin `period`, el mes (como los demás widgets con pestañas).
    await request(app.getHttpServer())
      .get("/reports/dashboard/control")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/reports/dashboard/control?period=ayer")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);

    for (const permisos of [["pos:sell", "pos:view"], ["inventory:read"]]) {
      const sinReportes = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId,
        permissions: permisos,
        locale: "es",
      });
      await request(app.getHttpServer())
        .get("/reports/dashboard/control?period=month")
        .set("Authorization", `Bearer ${sinReportes}`)
        .expect(403);
    }
  });

  it("un vendedor sin reports:read -> 403: los números del negocio no son del mostrador", async () => {
    const { tenantId } = await ownerToken();
    const vendedor = tokenService.signAccessToken({
      sub: randomUUID(),
      tenantId,
      permissions: ["pos:sell", "pos:view"],
      locale: "es",
    });

    await request(app.getHttpServer())
      .get("/reports/dashboard/kpis")
      .set("Authorization", `Bearer ${vendedor}`)
      .expect(403);
  });
});
