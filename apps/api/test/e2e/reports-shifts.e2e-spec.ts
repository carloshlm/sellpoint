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

    // Turno 2 (cajero, Norte): abre con $200 de fondo (F10-MANFIX-10) y vende
    // 50 en efectivo; cierra cuadrado contando 250.
    const t2 = await post(cajeroToken, "/pos/session", {
      warehouseId: norteId,
      openingCash: 200,
    }).expect(201);
    turnoNorteId = (t2.body as { id: string }).id;
    await post(cajeroToken, "/pos/sales", {
      paymentMethod: "cash",
      lines: [{ productId: producto.id, quantity: 1 }],
    }).expect(201);
    await post(cajeroToken, "/pos/session/close", { declaredCash: 250 }).expect(200);
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
      // F10-MANFIX-10: abrió sin fondo, así que su esperado es el de siempre.
      openingCash: "0",
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
    // El fondo va en la fila, y lo calculado ya lo trae sumado: 200 + 50.
    expect(norte).toMatchObject({
      closedBy: { id: cajeroId, name: "Beto Caja" },
      openingCash: "200",
      calculatedCash: "250",
      declaredCash: "250",
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
      // F9-EXP-10: «Gastos en efectivo» antes de «Calculado» (el calculado ya
      // los resta). F10-MANFIX-10: «Fondo inicial» antes de los gastos (el
      // calculado ya lo suma).
      // Carlos (2026-11-16): el folio del turno va primero, como en la pantalla.
      "Folio,Apertura,Cierre,Sucursal,Abrió,Cerró,Efectivo,Tarjeta,Transferencia,Ventas,Fondo inicial,Gastos en efectivo,Calculado,Contado,Diferencia,Nota",
    );
    expect(lineas.some((l) => l.startsWith("TUR-000001,"))).toBe(true);
    // Central tiene DOS cierres: el del arqueo y el que abrió y cerró el caso de `status=open`.
    expect(lineas).toHaveLength(3);
    // Apertura y cierre van como fecha y hora del NEGOCIO («2026-09-06 17:30»),
    // no como la marca ISO en UTC que nadie lee en una hoja de cálculo.
    expect(lineas[1]).toMatch(
      /^TUR-\d{6},\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2},/,
    );
    expect(
      lineas.some((l) =>
        // …,Ventas,Fondo inicial,Gastos en efectivo,Calculado,…: el turno abrió
        // sin fondo (0) y no tuvo gastos del cajón (0).
        l.includes(",Ana Pérez,Ana Pérez,100,50,0,2,0,0,100,90,-10,Faltó un billete de 10"),
      ),
    ).toBe(true);
    // El turno de Norte, con su fondo: 200 de fondo + 50 vendidos = 250.
    const norte = await descargar(
      negocio.token,
      `/reports/shifts/export?format=csv&warehouseId=${norteId}`,
    ).expect(200);
    expect((norte.body as Buffer).toString("utf8")).toContain(
      ",Beto Caja,Beto Caja,50,0,0,1,200,0,250,250,0,",
    );

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
      "Folio,Opened,Closed,Store,Opened by,Closed by,Cash,Card,Transfer,Sales,Opening cash,Cash expenses,Expected,Counted,Difference,Note",
    );
    await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", bearer(negocio.token))
      .send({ locale: "es" })
      .expect(200);
  });

  /**
   * Carlos (2026-11-16): «yo tal vez preferiría que hubiera un folio de cierre
   * de turno para encontrarlo más fácilmente en los reportes». Cada turno toma
   * su folio `TUR` al ABRIR, consecutivo por negocio, como las ventas.
   */
  describe("el folio del turno", () => {
    it("cada turno toma su folio al abrir, consecutivo por negocio", async () => {
      const res = await get(negocio.token, "/reports/shifts").expect(200);
      const filas = (res.body as { rows: { id: string; folio: string }[] }).rows;
      expect(filas.find((r) => r.id === turnoCentralId)?.folio).toBe("TUR-000001");
      expect(filas.find((r) => r.id === turnoNorteId)?.folio).toBe("TUR-000002");

      const detalle = await get(negocio.token, `/reports/shifts/${turnoNorteId}`).expect(200);
      expect((detalle.body as { folio: string }).folio).toBe("TUR-000002");
    });

    it("abrir devuelve el folio y cerrar devuelve el mismo", async () => {
      const abierto = await post(negocio.token, "/pos/session", { warehouseId: centralId }).expect(
        201,
      );
      const folio = (abierto.body as { folio: string }).folio;
      expect(folio).toMatch(/^TUR-\d{6}$/);
      // Buscar el folio lo encuentra aunque el turno siga abierto: quien tiene
      // el folio en la mano no sabe si ya cerró.
      const buscado = await get(negocio.token, `/reports/shifts?search=${folio}`).expect(200);
      expect((buscado.body as { rows: { folio: string; status: string }[] }).rows).toEqual([
        expect.objectContaining({ folio, status: "open" }),
      ]);
      // …también con su empleado elegido: en un abierto cuenta quién lo abrió.
      const conEmpleado = await get(
        negocio.token,
        `/reports/shifts?search=${folio}&userId=${negocio.userId}`,
      ).expect(200);
      expect((conEmpleado.body as { rows: { folio: string }[] }).rows.map((r) => r.folio)).toEqual([
        folio,
      ]);
      const cerrado = await post(negocio.token, "/pos/session/close", { declaredCash: 0 }).expect(
        200,
      );
      expect((cerrado.body as { session: { folio: string } }).session.folio).toBe(folio);
    });

    it("se busca por folio, completo o por su número", async () => {
      const completo = await get(negocio.token, "/reports/shifts?search=tur-000002").expect(200);
      expect((completo.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
        turnoNorteId,
      ]);
      const numero = await get(negocio.token, "/reports/shifts?search=000001").expect(200);
      expect((numero.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
        turnoCentralId,
      ]);
    });
  });

  /**
   * Carlos (2026-11-16): el cierre «con su header y abajo el detalle», en PDF
   * carta, «sólo para control interno». Desde el reporte (`reports:read`) y
   * desde la caja, el de SU propio turno (`pos:sell`).
   */
  describe("el PDF del cierre", () => {
    const bajar = (token: string, url: string) =>
      request(app.getHttpServer())
        .get(url)
        .set("Authorization", bearer(token))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });

    // Carlos (2026-11-16): «para turno no debe llevar la palabra cierre-de-turno-
    // o shift-close-, deberían quedar como TUR-000019.pdf o SHF-000019.pdf».
    it("el reporte lo baja en PDF y el archivo se llama solo con el folio", async () => {
      const res = await bajar(negocio.token, `/reports/shifts/${turnoCentralId}/pdf`).expect(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="TUR-000001.pdf"');
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
      await bajar(negocio.token, `/reports/shifts/${randomUUID()}/pdf`).expect(404);
    });

    it("el nombre no cambia con el idioma de quien lo baja", async () => {
      const enIngles = tokenService.signAccessToken({
        sub: cajeroId,
        tenantId: negocio.tenantId,
        permissions: ["reports:read"],
        locale: "en",
      });
      const res = await bajar(enIngles, `/reports/shifts/${turnoCentralId}/pdf`).expect(200);
      expect(res.headers["content-disposition"]).toBe('attachment; filename="TUR-000001.pdf"');
    });

    /**
     * Carlos (2026-11-16): «TUR-000019 para un negocio en mexico y SHF-000019
     * para un negocio en países como Canadá y Estados Unidos».
     */
    it("un negocio en Estados Unidos abre su turno como SHF-000001 y su PDF es SHF-000001.pdf", async () => {
      const enEstadosUnidos = await registerTenant(app, "shifts-us");
      await prisma.tenant.update({
        where: { id: enEstadosUnidos.tenantId },
        data: { country: "US" },
      });
      const almacen = await almacenInicial(prisma, enEstadosUnidos.tenantId);

      const abierto = await post(enEstadosUnidos.token, "/pos/session", {
        warehouseId: almacen,
      }).expect(201);
      const turno = abierto.body as { id: string; folio: string };
      expect(turno.folio).toBe("SHF-000001");

      const pdf = await bajar(enEstadosUnidos.token, `/reports/shifts/${turno.id}/pdf`).expect(200);
      expect(pdf.headers["content-disposition"]).toBe('attachment; filename="SHF-000001.pdf"');
    });

    it("desde la caja, quien vende baja el de su turno; el de otro no existe para él", async () => {
      const soloVende = tokenService.signAccessToken({
        sub: cajeroId,
        tenantId: negocio.tenantId,
        permissions: ["pos:sell"],
        locale: "es",
      });
      const propio = await bajar(soloVende, `/pos/session/${turnoNorteId}/pdf`).expect(200);
      expect(propio.headers["content-disposition"]).toBe('attachment; filename="TUR-000002.pdf"');
      await bajar(soloVende, `/pos/session/${turnoCentralId}/pdf`).expect(404);
      // Sin `reports:read`, el del reporte no.
      await bajar(soloVende, `/reports/shifts/${turnoNorteId}/pdf`).expect(403);
    });
  });

  /**
   * El respaldo del deploy: el API anterior abre turnos sin folio mientras
   * corre la migración o si el deploy regresa a la versión vieja. La base le
   * pone uno «PEND-…» en vez de rechazar el turno.
   */
  it("un turno que llega sin folio recibe el de respaldo en vez de rebotar", async () => {
    const turno = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.cashboxSession.create({
        data: { tenantId: negocio.tenantId, warehouseId: norteId, openedBy: cajeroId },
      }),
    );
    expect(turno.folio).toMatch(/^PEND-[0-9a-f]{12}$/);
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.cashboxSession.delete({ where: { id: turno.id } }),
    );
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
