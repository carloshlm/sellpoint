import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { localCalendarDate } from "@sellpoint/shared";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  bearer,
  cargarStock,
  crearProducto,
  registerTenant,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

const TZ = "America/Mexico_City";

/**
 * F5-SHIFT-01/02 — el reporte de cierres de turno: una lectura de lo que el
 * cierre guardó (declarado, calculado, diferencia, nota), con el mismo
 * alcance por almacén que Ventas y el calendario del negocio.
 */
describe("Reporte de cierres de turno (F5-SHIFT)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let negocio: TenantFixture;
  let cajeroToken: string;
  let cajeroId: string;
  let centralId: string;
  let norteId: string;
  let turnoCentralId: string;
  let turnoNorteId: string;

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  const post = (token: string, url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    negocio = await registerTenant(app, "shifts");
    await prisma.tenant.update({ where: { id: negocio.tenantId }, data: { timezone: TZ } });
    centralId = await almacenInicial(prisma, negocio.tenantId);
    norteId = (
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.warehouse.create({
          data: {
            tenantId: negocio.tenantId,
            code: `N-${randomUUID().slice(0, 6)}`,
            name: "Norte",
          },
        }),
      )
    ).id;
    const producto = await crearProducto(app, negocio.token, 50);
    await cargarStock(app, negocio.token, centralId, producto.id, 20);
    await cargarStock(app, negocio.token, norteId, producto.id, 20);

    // Un segundo cajero, con todos los permisos del dueño pero identidad propia.
    const cajero = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId: negocio.tenantId,
          email: `cajero-${randomUUID()}@example.com`,
          firstName: "Beto",
          lastName: "Caja",
          status: "active",
          emailVerifiedAt: new Date(),
        },
      }),
    );
    cajeroId = cajero.id;
    cajeroToken = tokenService.signAccessToken({
      sub: cajero.id,
      tenantId: negocio.tenantId,
      permissions: ["pos:sell", "pos:view", "reports:read"],
      locale: "es",
    });

    // Turno 1 (dueño, Central): efectivo 100 + tarjeta 50; cierra declarando 90 → falta 10.
    const t1 = await post(negocio.token, "/pos/session", { warehouseId: centralId }).expect(201);
    turnoCentralId = (t1.body as { id: string }).id;
    await post(negocio.token, "/pos/sales", {
      paymentMethod: "cash",
      lines: [{ productId: producto.id, quantity: 2 }],
    }).expect(201);
    await post(negocio.token, "/pos/sales", {
      paymentMethod: "card",
      lines: [{ productId: producto.id, quantity: 1 }],
    }).expect(201);
    await post(negocio.token, "/pos/session/close", {
      declaredCash: 90,
      note: "Faltó un billete de 10",
    }).expect(200);

    // Turno 2 (cajero, Norte): una venta en efectivo de 50; cierra cuadrado.
    const t2 = await post(cajeroToken, "/pos/session", { warehouseId: norteId }).expect(201);
    turnoNorteId = (t2.body as { id: string }).id;
    await post(cajeroToken, "/pos/sales", {
      paymentMethod: "cash",
      lines: [{ productId: producto.id, quantity: 1 }],
    }).expect(201);
    await post(cajeroToken, "/pos/session/close", { declaredCash: 50 }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it("lista los cierres con arqueo, nota, quién y totales por forma de pago", async () => {
    const res = await get(negocio.token, "/reports/shifts").expect(200);
    const body = res.body as { rows: Record<string, unknown>[]; total: number };
    expect(body.total).toBe(2);
    const central = body.rows.find((r) => r.id === turnoCentralId);
    expect(central).toMatchObject({
      status: "closed",
      warehouse: { id: centralId },
      openedBy: { name: "Ana Pérez" },
      closedBy: { name: "Ana Pérez" },
      salesCount: 2,
      calculatedCash: "100",
      declaredCash: "90",
      cashDifference: "-10",
      closingNote: "Faltó un billete de 10",
    });
    expect(
      (central as { totals: { method: string; total: string; count: number }[] }).totals,
    ).toEqual([
      { method: "cash", total: "100", count: 1 },
      { method: "card", total: "50", count: 1 },
      { method: "transfer", total: "0", count: 0 },
    ]);
    const norte = body.rows.find((r) => r.id === turnoNorteId);
    expect(norte).toMatchObject({
      closedBy: { id: cajeroId, name: "Beto Caja" },
      cashDifference: "0",
      closingNote: null,
    });
  });

  it("filtra por quien cerró y por almacén", async () => {
    const porCajero = await get(negocio.token, `/reports/shifts?userId=${cajeroId}`).expect(200);
    expect((porCajero.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
      turnoNorteId,
    ]);
    const porAlmacen = await get(negocio.token, `/reports/shifts?warehouseId=${centralId}`).expect(
      200,
    );
    expect((porAlmacen.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
      turnoCentralId,
    ]);
  });

  it("el rango corta por el día del NEGOCIO: hoy en CDMX trae los dos, ayer ninguno", async () => {
    const hoy = localCalendarDate(TZ, new Date());
    const ayer = localCalendarDate(TZ, new Date(Date.now() - 24 * 60 * 60 * 1000));
    const deHoy = await get(negocio.token, `/reports/shifts?from=${hoy}&to=${hoy}`).expect(200);
    expect((deHoy.body as { total: number }).total).toBe(2);
    const deAyer = await get(negocio.token, `/reports/shifts?from=${ayer}&to=${ayer}`).expect(200);
    expect((deAyer.body as { total: number }).total).toBe(0);
  });

  it("status=open lista el turno abierto sin arqueo", async () => {
    await post(negocio.token, "/pos/session", { warehouseId: centralId }).expect(201);
    const res = await get(negocio.token, "/reports/shifts?status=open").expect(200);
    const body = res.body as { rows: Record<string, unknown>[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ status: "open", closedAt: null, declaredCash: null });
    await post(negocio.token, "/pos/session/close", { declaredCash: 0 }).expect(200);
  });

  it("aplica el ALCANCE: un usuario acotado a Norte no ve el turno de Central, y pedirlo es 403", async () => {
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.userWarehouseScope.create({
        data: { tenantId: negocio.tenantId, userId: cajeroId, warehouseId: norteId },
      }),
    );
    const res = await get(cajeroToken, "/reports/shifts").expect(200);
    expect((res.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([turnoNorteId]);
    await get(cajeroToken, `/reports/shifts?warehouseId=${centralId}`).expect(403);
    // El detalle del turno ajeno tampoco existe para él.
    await get(cajeroToken, `/reports/shifts/${turnoCentralId}`).expect(404);
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.userWarehouseScope.deleteMany({ where: { userId: cajeroId } }),
    );
  });

  it("el detalle trae las ventas del turno, y no las de otro (F5-SHIFT-02)", async () => {
    const res = await get(negocio.token, `/reports/shifts/${turnoCentralId}`).expect(200);
    const body = res.body as {
      salesCount: number;
      sales: { folio: string; paymentMethod: string; total: string; seller: { name: string } }[];
    };
    expect(body.salesCount).toBe(2);
    expect(body.sales.map((v) => v.paymentMethod)).toEqual(["cash", "card"]);
    expect(body.sales[0]).toMatchObject({ total: "100", seller: { name: "Ana Pérez" } });
    await get(negocio.token, `/reports/shifts/${randomUUID()}`).expect(404);
  });

  it("exporta las filas del filtro, con la diferencia con signo y el nombre por idioma (F5-SHIFT-03)", async () => {
    const descargar = (token: string, url: string) =>
      request(app.getHttpServer())
        .get(url)
        .set("Authorization", bearer(token))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
    const csv = await descargar(
      negocio.token,
      `/reports/shifts/export?format=csv&warehouseId=${centralId}`,
    ).expect(200);
    expect(csv.headers["content-disposition"]).toContain('filename="cierres-de-turno.csv"');
    const lineas = (csv.body as Buffer)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\n");
    expect(lineas[0]).toBe(
      "Apertura,Cierre,Almacén,Abrió,Cerró,Efectivo,Tarjeta,Transferencia,Ventas,Calculado,Contado,Diferencia,Nota",
    );
    // Central tiene DOS cierres: el del arqueo y el que abrió y cerró el caso de `status=open`.
    expect(lineas).toHaveLength(3);
    // Apertura y cierre van como fecha y hora del NEGOCIO («2026-09-06 17:30»),
    // no como la marca ISO en UTC que nadie lee en una hoja de cálculo.
    expect(lineas[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2},/);
    expect(
      lineas.some((l) =>
        l.includes(",Ana Pérez,Ana Pérez,100,50,0,2,100,90,-10,Faltó un billete de 10"),
      ),
    ).toBe(true);

    // En inglés: el JWT del usuario manda el idioma.
    await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", bearer(negocio.token))
      .send({ locale: "en" })
      .expect(200);
    const sesionEn = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: negocio.email, password: "twelve-characters" })
      .expect(200);
    const tokenEn = (sesionEn.body as { accessToken: string }).accessToken;
    const en = await descargar(tokenEn, "/reports/shifts/export?format=csv").expect(200);
    expect(en.headers["content-disposition"]).toContain('filename="shift-closes.csv"');
    expect(
      (en.body as Buffer)
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .split("\n")[0],
    ).toBe(
      "Opened,Closed,Warehouse,Opened by,Closed by,Cash,Card,Transfer,Sales,Expected,Counted,Difference,Note",
    );
    await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", bearer(negocio.token))
      .send({ locale: "es" })
      .expect(200);
  });

  it("sin reports:read → 403", async () => {
    const soloVende = tokenService.signAccessToken({
      sub: cajeroId,
      tenantId: negocio.tenantId,
      permissions: ["pos:sell"],
      locale: "es",
    });
    await get(soloVende, "/reports/shifts").expect(403);
  });
});
