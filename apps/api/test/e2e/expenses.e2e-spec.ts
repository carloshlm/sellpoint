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
            folio: "GAS-000001",
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
