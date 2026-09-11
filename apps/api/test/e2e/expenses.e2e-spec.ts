import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { EntitlementsService } from "../../src/modules/billing/entitlements.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-EXP — Gastos de punta a punta.
 *
 * Categorías (F9-EXP-03): el negocio nace con las 18 de fábrica en su idioma;
 * sin el módulo (un Free) hasta leerlas responde 402; Viewer lee y recibe 403
 * al crear; borrar una en uso es 409 y desactivarla la esconde del selector
 * (`isActive=true`).
 */
describe("Gastos (F9-EXP)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let sinModulo: TenantFixture;
  let viewerToken: string;

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer(token)),
    post: (url: string, body: object) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set("Authorization", bearer(token)).send(body),
    delete: (url: string) =>
      request(app.getHttpServer()).delete(url).set("Authorization", bearer(token)),
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    // El trial Plus trae Gastos incluido (F9-PLANMOD): no hay nada que pactar.
    negocio = await registerTenant(app, "exp");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "exp-viewer");
    // Un Free NO incluye Gastos (`MODULE_MIN_PLAN.expenses = "basic"`). Free
    // no se CONTRATA por el backoffice (es el estado al que cae quien no
    // paga), así que el plan contratado se fija en la fila y se limpia la
    // caché de entitlements — lo mismo que dejaría un negocio nacido sin trial.
    sinModulo = await registerTenant(app, "exp-free");
    await prisma.withTenantContext(sinModulo.tenantId, async (tx) => {
      const free = await tx.plan.findUniqueOrThrow({ where: { code: "free" } });
      await tx.tenantSubscription.update({
        where: { tenantId: sinModulo.tenantId },
        data: { planId: free.id },
      });
    });
    await app.get(EntitlementsService).invalidate(sinModulo.tenantId);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * F9-EXP-05..08 — el gasto por el API: crear pendiente y pagado, listar y
   * buscar, las rutas fijas (`summary`, `accounts`, `export`) que no caen en
   * `:id`, pagar y anular con sus permisos, y el gasto en efectivo ligado al
   * turno abierto.
   */
  describe("gastos (F9-EXP-05..08)", () => {
    let categoriaId: string;
    let almacenId: string;

    beforeAll(async () => {
      const categorias = await api(negocio.token)
        .get("/expenses/categories?query=internet")
        .expect(200);
      categoriaId = ((categorias.body as { rows: { id: string }[] }).rows[0] as { id: string }).id;
      almacenId = (
        await prisma.withTenantContext(negocio.tenantId, (tx) =>
          tx.warehouse.findFirstOrThrow({ select: { id: true } }),
        )
      ).id;
    });

    const gasto = (extra: Record<string, unknown> = {}) => ({
      expenseDate: "2026-09-10",
      categoryId: categoriaId,
      description: "Internet de septiembre",
      amount: 116,
      ...extra,
    });

    it("Viewer lee y recibe 403 al registrar; el Admin registra un pendiente con folio GAS", async () => {
      await api(viewerToken).get("/expenses").expect(200);
      await api(viewerToken).post("/expenses", gasto()).expect(403);

      const creado = await api(negocio.token).post("/expenses", gasto()).expect(201);
      expect(creado.body).toMatchObject({
        folio: "GAS-000001",
        status: "active",
        paymentStatus: "pending",
        paymentMethod: null,
        warehouseId: almacenId,
        categoryName: "Internet",
        total: "116",
      });
      // Un campo desconocido es un error del cliente, no se ignora.
      await api(negocio.token)
        .post("/expenses", gasto({ foo: 1 }))
        .expect(400);
      // Proveedor y beneficiario a la vez rebotan en el DTO.
      await api(negocio.token)
        .post("/expenses", gasto({ beneficiary: "Pepe", supplierId: almacenId }))
        .expect(400);
    });

    it("las rutas fijas van antes de `:id`: summary, accounts y export responden por su nombre", async () => {
      await api(negocio.token)
        .post("/expenses", gasto({ paymentMethod: "transfer", accountRef: "BBVA", amount: 58 }))
        .expect(201);
      const resumen = await api(negocio.token).get("/expenses/summary").expect(200);
      const cuerpo = resumen.body as {
        count: number;
        total: string;
        byCategory: { categoryName: string; total: string }[];
        byPaymentStatus: { pending: string; paid: string };
      };
      expect(cuerpo.count).toBeGreaterThanOrEqual(2);
      expect(cuerpo.byCategory.map((c) => c.categoryName)).toContain("Internet");
      expect(Number(cuerpo.byPaymentStatus.paid)).toBeGreaterThanOrEqual(58);

      const cuentas = await api(negocio.token).get("/expenses/accounts").expect(200);
      expect(cuentas.body).toEqual(["BBVA"]);

      const csv = await api(negocio.token)
        .get("/expenses/export?format=csv&from=2020-01-01&to=2020-01-31")
        .expect(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      // Cero filas no es un error: la planilla con solo encabezados dice la verdad.
      expect(csv.text).toContain("Folio");
      expect(csv.text.trim().split("\n")).toHaveLength(1);
    });

    it("listar busca por texto y filtra por día del negocio y estado de pago", async () => {
      const lista = await api(negocio.token)
        .get("/expenses?query=internet&paymentStatus=paid&from=2026-09-10&to=2026-09-10")
        .expect(200);
      const filas = (lista.body as { rows: { paymentStatus: string; total: string }[] }).rows;
      expect(filas.length).toBeGreaterThanOrEqual(1);
      expect(filas.every((f) => f.paymentStatus === "paid")).toBe(true);
      await api(negocio.token).get("/expenses?from=2026-09-10&to=2026-09-01").expect(400);
    });

    it("pagar es entero y una sola vez; anular exige :cancel (Viewer 403) y deja de contar en el resumen", async () => {
      const creado = await api(negocio.token)
        .post("/expenses", gasto({ amount: 232 }))
        .expect(201);
      const id = (creado.body as { id: string }).id;
      const pagado = await api(negocio.token)
        .post(`/expenses/${id}/pay`, { paymentMethod: "card" })
        .expect(200);
      expect(pagado.body).toMatchObject({ paymentStatus: "paid", paymentMethod: "card" });
      await api(negocio.token).post(`/expenses/${id}/pay`, { paymentMethod: "card" }).expect(409);
      // Pagado: el monto ya no se toca; las notas sí.
      await api(negocio.token).patch(`/expenses/${id}`, { amount: 100 }).expect(409);
      await api(negocio.token).patch(`/expenses/${id}`, { notes: "ok" }).expect(200);

      const antes = await api(negocio.token).get("/expenses/summary").expect(200);
      await api(viewerToken).post(`/expenses/${id}/cancel`, { reason: "duplicado" }).expect(403);
      await api(negocio.token).post(`/expenses/${id}/cancel`, { reason: "no" }).expect(400);
      const anulado = await api(negocio.token)
        .post(`/expenses/${id}/cancel`, { reason: "duplicado" })
        .expect(200);
      expect(anulado.body).toMatchObject({ status: "canceled", cancelReason: "duplicado" });
      await api(negocio.token).post(`/expenses/${id}/cancel`, { reason: "otra" }).expect(409);
      const despues = await api(negocio.token).get("/expenses/summary").expect(200);
      expect(Number((despues.body as { total: string }).total)).toBe(
        Number((antes.body as { total: string }).total) - 232,
      );
    });

    /**
     * F9-EXP-09 — el arqueo: vender 150 en efectivo y pagar 50 del cajón deja
     * `totals.cash 150` (las ventas no cambian), `cashExpenses 50` y
     * `expectedCash 100`; cerrar declarando 100 cuadra en cero y persiste el
     * calculado ya neteado. Anular el gasto antes de cerrar devuelve el esperado.
     */
    it("el cierre resta del efectivo esperado los gastos pagados del cajón", async () => {
      const cajero = await usuarioConRol(app, negocio, "Manager", "exp-cajero");
      const turno = await request(app.getHttpServer())
        .post("/pos/session")
        .set("Authorization", bearer(cajero))
        .send({ warehouseId: almacenId })
        .expect(201);
      const sesionId = (turno.body as { id: string }).id;
      // Una venta en efectivo por el camino real: producto con existencias.
      const { productoId } = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
        const producto = await tx.product.create({
          data: { tenantId: negocio.tenantId, sku: `EXP-${Date.now()}`, name: "Paracetamol" },
        });
        await tx.productPresentation.create({
          data: {
            tenantId: negocio.tenantId,
            productId: producto.id,
            name: "Pieza",
            factor: "1",
            price: "15.00",
            isDefaultSale: true,
            allowFractionalInput: false,
          },
        });
        await tx.stockByWarehouse.create({
          data: {
            tenantId: negocio.tenantId,
            productId: producto.id,
            warehouseId: almacenId,
            quantity: 100,
          },
        });
        return { productoId: producto.id };
      });
      await request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(cajero))
        .send({ paymentMethod: "cash", lines: [{ productId: productoId, quantity: 10 }] })
        .expect(201);
      const gastoDelCajon = await api(negocio.token)
        .post(
          "/expenses",
          gasto({
            paymentMethod: "cash",
            cashboxSessionId: sesionId,
            amount: 50,
            warehouseId: almacenId,
          }),
        )
        .expect(201);

      const arqueo = await request(app.getHttpServer())
        .get("/pos/session/totals")
        .set("Authorization", bearer(cajero))
        .expect(200);
      expect(arqueo.body).toMatchObject({
        cashExpenses: { total: "50", count: 1 },
        expectedCash: "100",
      });
      expect(
        (arqueo.body as { totals: { method: string; total: string }[] }).totals.find(
          (t) => t.method === "cash",
        )?.total,
      ).toBe("150");

      // Anular el gasto antes de cerrar: el esperado vuelve a las ventas.
      await api(negocio.token)
        .post(`/expenses/${(gastoDelCajon.body as { id: string }).id}/cancel`, { reason: "error" })
        .expect(200);
      const sinGasto = await request(app.getHttpServer())
        .get("/pos/session/totals")
        .set("Authorization", bearer(cajero))
        .expect(200);
      expect((sinGasto.body as { expectedCash: string }).expectedCash).toBe("150");

      // Otro gasto de 50 y el cierre declarando 100: cuadra en cero.
      await api(negocio.token)
        .post(
          "/expenses",
          gasto({
            paymentMethod: "cash",
            cashboxSessionId: sesionId,
            amount: 50,
            warehouseId: almacenId,
          }),
        )
        .expect(201);
      const cierre = await request(app.getHttpServer())
        .post("/pos/session/close")
        .set("Authorization", bearer(cajero))
        .send({ declaredCash: 100 })
        .expect(200);
      expect(cierre.body).toMatchObject({
        session: { calculatedCash: "100", declaredCash: "100", cashDifference: "0" },
        cashExpenses: { total: "50", count: 1 },
        expectedCash: "100",
      });

      // Y el reporte de cierres lo cuenta igual que el papel.
      const reporte = await request(app.getHttpServer())
        .get(`/reports/shifts/${sesionId}`)
        .set("Authorization", bearer(negocio.token))
        .expect(200);
      expect(reporte.body).toMatchObject({
        cashExpenses: { total: "50", count: 1 },
        calculatedCash: "100",
      });
    });

    it("un gasto en efectivo sale del turno abierto; cerrado o de otro cajero no", async () => {
      const turno = await request(app.getHttpServer())
        .post("/pos/session")
        .set("Authorization", bearer(negocio.token))
        .send({})
        .expect(201);
      const sesionId = (turno.body as { id: string }).id;
      const ligado = await api(negocio.token)
        .post("/expenses", gasto({ paymentMethod: "cash", cashboxSessionId: sesionId, amount: 50 }))
        .expect(201);
      expect(ligado.body).toMatchObject({ paymentStatus: "paid", cashboxSessionId: sesionId });
      // Con tarjeta no hay cajón del que salir.
      await api(negocio.token)
        .post("/expenses", gasto({ paymentMethod: "card", cashboxSessionId: sesionId }))
        .expect(400);
      await request(app.getHttpServer())
        .post("/pos/session/close")
        .set("Authorization", bearer(negocio.token))
        .send({ declaredCash: 0 })
        .expect(200);
      await api(negocio.token)
        .post("/expenses", gasto({ paymentMethod: "cash", cashboxSessionId: sesionId }))
        .expect(409);
      // Y el gasto de un turno CERRADO ya no se anula: libro cerrado.
      await api(negocio.token)
        .post(`/expenses/${(ligado.body as { id: string }).id}/cancel`, { reason: "tarde" })
        .expect(409);
    });
  });

  describe("categorías (F9-EXP-03)", () => {
    it("sin el módulo, hasta leer las categorías responde 402", async () => {
      await api(sinModulo.token).get("/expenses/categories").expect(402);
      await api(sinModulo.token).post("/expenses/categories", { name: "X" }).expect(402);
    });

    it("el negocio nace con las 18 de fábrica, en su idioma y en su orden", async () => {
      const res = await api(negocio.token).get("/expenses/categories").expect(200);
      const filas = (res.body as { rows: { code: string; name: string; sortOrder: number }[] })
        .rows;
      expect(filas).toHaveLength(18);
      expect(filas[0]).toMatchObject({ code: "rent", name: "Renta", sortOrder: 0 });
      expect(filas[17]).toMatchObject({ code: "other", name: "Otros", sortOrder: 170 });
    });

    it("Viewer lee y recibe 403 al crear; el Admin crea con código derivado del nombre", async () => {
      await api(viewerToken).get("/expenses/categories").expect(200);
      await api(viewerToken).post("/expenses/categories", { name: "Mensajería" }).expect(403);

      const creada = await api(negocio.token)
        .post("/expenses/categories", { name: "Mensajería" })
        .expect(201);
      expect(creada.body).toMatchObject({ code: "mensajeria", name: "Mensajería", sortOrder: 180 });
      await api(negocio.token).post("/expenses/categories", { name: "Mensajería" }).expect(409);
    });

    it("borrar una categoría con gastos es 409; desactivarla la esconde del selector", async () => {
      const lista = await api(negocio.token).get("/expenses/categories?query=rent").expect(200);
      const renta = (lista.body as { rows: { id: string }[] }).rows[0] as { id: string };
      // Un gasto que la nombra, directo en la tabla (el API de gastos llega en F9-EXP-07).
      await prisma.withTenantContext(negocio.tenantId, async (tx) => {
        const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
        await tx.expense.create({
          data: {
            tenantId: negocio.tenantId,
            folio: "GAS-999999",
            warehouseId: almacen.id,
            expenseDate: new Date("2026-09-10"),
            categoryId: renta.id,
            description: "Renta de septiembre",
            amount: 100,
            total: 100,
            taxMode: "included",
            createdBy: negocio.userId,
          },
        });
      });
      const rebote = await api(negocio.token)
        .delete(`/expenses/categories/${renta.id}`)
        .expect(409);
      expect((rebote.body as { message: string }).message).toContain("desactivarla");

      await api(negocio.token)
        .patch(`/expenses/categories/${renta.id}`, { isActive: false })
        .expect(200);
      const activas = await api(negocio.token)
        .get("/expenses/categories?isActive=true")
        .expect(200);
      expect(
        (activas.body as { rows: { code: string }[] }).rows.some((c) => c.code === "rent"),
      ).toBe(false);
    });
  });
});
