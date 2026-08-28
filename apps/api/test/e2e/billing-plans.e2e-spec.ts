import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, registerTenant, setTenantMarket } from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

type PublicPlan = { code: string; price: { currency: string; monthly: string } | null };

/**
 * El catálogo público de planes (`GET /billing/plans`).
 *
 * ── El bug que estos tests existen para que no vuelva ───────────────────
 *
 * Carlos (2026-08-29): «si ingreso a ver planes me sale en dólares aunque la
 * moneda del cliente sea MXN». El endpoint es `@Public()` porque la landing
 * futura lo consumirá sin sesión, y `JwtAuthGuard` cortaba con `return true`
 * ANTES de leer el token: `@CurrentUser()` llegaba SIEMPRE `undefined`, así
 * que el país nunca se resolvía y todo el mundo veía la tarifa `US`.
 *
 * El agujero de los e2e de F7 fue probar `listPublicPlans(country)` a nivel
 * de servicio —que siempre funcionó— y no el ENDPOINT con una sesión real.
 * Un endpoint público que igual mira la sesión necesita que lo prueben las
 * dos formas: con sesión y sin ella.
 */
describe("Catálogo público de planes (GET /billing/plans)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const precioDe = (body: unknown, code: string) =>
    (body as PublicPlan[]).find((p) => p.code === code)?.price;

  describe("con sesión, manda el país del NEGOCIO", () => {
    it("un negocio mexicano ve pesos, no dólares", async () => {
      const negocio = await registerTenant(app, "plans-mx");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const res = await request(app.getHttpServer())
        .get("/billing/plans")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect(precioDe(res.body, "plus")).toEqual({
        currency: "MXN",
        monthly: "499",
        yearly: "4990",
      });
      expect(precioDe(res.body, "basic")?.currency).toBe("MXN");
    });

    it("un negocio canadiense ve dólares canadienses", async () => {
      const negocio = await registerTenant(app, "plans-ca");
      await setTenantMarket(prisma, negocio.tenantId, "CA");

      const res = await request(app.getHttpServer())
        .get("/billing/plans")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect(precioDe(res.body, "plus")?.currency).toBe("CAD");
    });

    /**
     * El caso REAL de los tenants viejos: `country` en NULL porque nacieron
     * antes de que el onboarding lo pidiera. La moneda del negocio es el
     * segundo mejor dato disponible — mucho mejor que asumir Estados Unidos
     * cuando el tenant lleva "MXN" escrito en su propia fila.
     */
    it("sin país pero con moneda MXN, ve pesos (los tenants anteriores al onboarding)", async () => {
      const negocio = await registerTenant(app, "plans-sin-pais");
      await prisma.tenant.update({
        where: { id: negocio.tenantId },
        data: { country: null, currency: "MXN" },
      });

      const res = await request(app.getHttpServer())
        .get("/billing/plans")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect(precioDe(res.body, "plus")?.currency).toBe("MXN");
    });

    it("el token invalido no rompe la vitrina: responde con la tarifa por defecto", async () => {
      const res = await request(app.getHttpServer())
        .get("/billing/plans")
        .set("Authorization", "Bearer no-es-un-token")
        .expect(200);

      expect(precioDe(res.body, "plus")?.currency).toBe("USD");
    });
  });

  describe("sin sesión (la landing)", () => {
    it("responde 200 y con `?country=MX` da pesos", async () => {
      const res = await request(app.getHttpServer()).get("/billing/plans?country=MX").expect(200);

      expect(precioDe(res.body, "plus")?.currency).toBe("MXN");
    });

    it("sin país, la tarifa US es el default internacional", async () => {
      const res = await request(app.getHttpServer()).get("/billing/plans").expect(200);

      expect(precioDe(res.body, "plus")?.currency).toBe("USD");
    });

    /**
     * La vitrina tiene que poder EXPLICAR qué incluye cada plan, y el control
     * de inventario —lo que separa a Basic de Pro— no vive en `features`
     * sino en una columna dura. Sin exponerlo, la pantalla de planes no
     * podría decir la diferencia más importante del catálogo.
     */
    it("cada plan viaja con lo que incluye: features, control de stock y límites", async () => {
      const res = await request(app.getHttpServer()).get("/billing/plans").expect(200);
      const planes = res.body as {
        code: string;
        stockControl: boolean;
        dailySalesLimit: number | null;
        features: Record<string, boolean>;
      }[];

      const basic = planes.find((p) => p.code === "basic");
      const pro = planes.find((p) => p.code === "pro");
      expect(basic?.stockControl).toBe(false);
      expect(pro?.stockControl).toBe(true);
      expect(basic?.features.quotes).toBe(false);
      expect(pro?.features.quotes).toBe(true);
      // Los planes de pago no tienen tope de ventas: NULL es "sin límite".
      expect(basic?.dailySalesLimit).toBeNull();
    });

    it("free no se vende y Premium sale sin precio (su CTA es contactar)", async () => {
      const res = await request(app.getHttpServer()).get("/billing/plans").expect(200);

      const codigos = (res.body as PublicPlan[]).map((p) => p.code);
      expect(codigos).not.toContain("free");
      expect(precioDe(res.body, "premium")).toBeNull();
    });
  });
});
