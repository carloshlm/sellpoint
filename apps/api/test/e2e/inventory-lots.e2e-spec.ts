import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/**
 * F3-LOTS-02 — consultar los lotes de un producto y las ubicaciones de un
 * almacén.
 *
 * Los dos existen para ALIMENTAR pantallas: el selector de "forzar lote" de
 * una salida y el autocompletado de ubicación de una entrada. Por eso el orden
 * del listado es **FEFO** y no alfabético — quien elige un lote a mano quiere
 * ver primero el que se vence antes, que es el que el sistema habría elegido
 * solo.
 */
describe("Lotes y ubicaciones (F3-LOTS-02)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (token: string) => `Bearer ${token}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant lots ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);

    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  /**
   * Tres lotes con caducidades desordenadas a propósito, repartidos en dos
   * almacenes y dos ubicaciones. Si el endpoint ordenara por código o por
   * fecha de alta, este escenario lo delataría.
   */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();
    const datos = await prisma.withTenantContext(tenantId, async (tx) => {
      const producto = await tx.product.create({
        data: {
          tenantId,
          sku: `LOT-${randomUUID().slice(0, 8)}`,
          name: "Suero con caducidad",
          tracksLots: true,
        },
      });
      const [central, norte] = await Promise.all([
        tx.warehouse.create({ data: { tenantId, name: `Central ${randomUUID().slice(0, 6)}` } }),
        tx.warehouse.create({ data: { tenantId, name: `Norte ${randomUUID().slice(0, 6)}` } }),
      ]);

      // st30 vence DESPUÉS que st10; sinFecha no vence nunca.
      const [st30, st10, sinFecha] = await Promise.all([
        tx.productLot.create({
          data: {
            tenantId,
            productId: producto.id,
            lotCode: "st30",
            expiresAt: new Date("2026-09-30"),
          },
        }),
        tx.productLot.create({
          data: {
            tenantId,
            productId: producto.id,
            lotCode: "st10",
            expiresAt: new Date("2026-07-01"),
          },
        }),
        tx.productLot.create({ data: { tenantId, productId: producto.id, lotCode: "sinFecha" } }),
      ]);

      await tx.stockLot.createMany({
        data: [
          // st30 repartido en dos almacenes y dos ubicaciones: su total suma 3.
          { tenantId, lotId: st30.id, warehouseId: central.id, location: "A-1", quantity: 1 },
          { tenantId, lotId: st30.id, warehouseId: norte.id, location: "B-2", quantity: 2 },
          { tenantId, lotId: st10.id, warehouseId: central.id, location: "A-1", quantity: 5 },
          // Agotado: existe el registro pero no el saldo.
          { tenantId, lotId: sinFecha.id, warehouseId: central.id, location: "", quantity: 0 },
        ],
      });

      return { productId: producto.id, centralId: central.id, norteId: norte.id };
    });

    return { token, tenantId, ...datos };
  }

  describe("GET /products/:id/lots", () => {
    it("los devuelve en orden FEFO, con los sin fecha AL FINAL", async () => {
      const { token, productId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (res.body as { lotCode: string }[]).map((l) => l.lotCode);
      // Un lote SIN caducidad no es "el más urgente" sino lo contrario: no
      // corre riesgo de vencerse, así que sale cuando ya no queda nada que sí.
      expect(codigos).toEqual(["st10", "st30", "sinFecha"]);
    });

    it("`totalQuantity` suma todos los almacenes y `byWarehouse` los desglosa", async () => {
      const { token, productId, centralId, norteId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(token))
        .expect(200);

      const st30 = (
        res.body as { lotCode: string; totalQuantity: string; byWarehouse: unknown[] }[]
      ).find((l) => l.lotCode === "st30");
      expect(st30?.totalQuantity).toBe("3");
      expect(st30?.byWarehouse).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ warehouseId: centralId, location: "A-1", quantity: "1" }),
          expect.objectContaining({ warehouseId: norteId, location: "B-2", quantity: "2" }),
        ]),
      );
    });

    /** El selector de "forzar lote" no debe ofrecer un lote agotado. */
    it("`?withStock=true` esconde los que están en cero", async () => {
      const { token, productId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots?withStock=true`)
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (res.body as { lotCode: string }[]).map((l) => l.lotCode);
      expect(codigos).toEqual(["st10", "st30"]);
    });

    it("`?warehouseId=` acota el saldo a ese almacén", async () => {
      const { token, productId, centralId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots?warehouseId=${centralId}&withStock=true`)
        .set("Authorization", bearer(token))
        .expect(200);

      const st30 = (res.body as { lotCode: string; totalQuantity: string }[]).find(
        (l) => l.lotCode === "st30",
      );
      // En Central st30 tiene 1, no los 3 del total: acotar tiene que cambiar
      // el número, no solo filtrar filas.
      expect(st30?.totalQuantity).toBe("1");
    });

    it("un producto de otro tenant no existe (404)", async () => {
      const { productId } = await escenario();
      const { token: ajeno } = await registerAndLogin();

      await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(ajeno))
        .expect(404);
    });
  });

  describe("GET /warehouses/:id/locations", () => {
    it("devuelve las ubicaciones DISTINTAS ya usadas, sin repetir", async () => {
      const { token, centralId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/warehouses/${centralId}/locations`)
        .set("Authorization", bearer(token))
        .expect(200);

      // "A-1" está en dos lotes distintos y aparece UNA vez. El `''` (sin
      // ubicación) no es una ubicación: no se ofrece para autocompletar.
      expect(res.body).toEqual(["A-1"]);
    });

    it("un almacén sin ubicaciones devuelve lista vacía, no 404", async () => {
      const { token, norteId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/warehouses/${norteId}/locations`)
        .set("Authorization", bearer(token))
        .expect(200);

      expect(res.body).toEqual(["B-2"]);
    });

    it("un almacén de otro tenant no existe (404)", async () => {
      const { centralId } = await escenario();
      const { token: ajeno } = await registerAndLogin();

      await request(app.getHttpServer())
        .get(`/warehouses/${centralId}/locations`)
        .set("Authorization", bearer(ajeno))
        .expect(404);
    });
  });

  /**
   * El alcance por almacén, contra los dos endpoints.
   *
   * El token se firma con permisos REDUCIDOS a propósito: un TenantAdmin
   * bypasea el scope a `"all"` (F2-SCOPE-01), así que con su token esto no
   * probaría nada. Con `inventory:read` a secas el interceptor va a la DB y
   * resuelve el alcance real.
   */
  describe("alcance por almacén", () => {
    async function conAlcanceSoloEnNorte() {
      const base = await escenario();
      const tokenService = app.get(TokenService);

      const userId = await prisma.withTenantContext(base.tenantId, async (tx) => {
        const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
        await tx.userWarehouseScope.create({
          data: { userId: owner.id, warehouseId: base.norteId, tenantId: base.tenantId },
        });
        return owner.id;
      });

      const scopedToken = tokenService.signAccessToken({
        sub: userId,
        tenantId: base.tenantId,
        permissions: ["inventory:read"],
        locale: "es",
      });

      return { ...base, scopedToken };
    }

    it("las ubicaciones de un almacén FUERA de alcance dan 403", async () => {
      const { scopedToken, centralId } = await conAlcanceSoloEnNorte();

      await request(app.getHttpServer())
        .get(`/warehouses/${centralId}/locations`)
        .set("Authorization", bearer(scopedToken))
        .expect(403);
    });

    it("las del almacén que SÍ administra, en cambio, se ven", async () => {
      const { scopedToken, norteId } = await conAlcanceSoloEnNorte();

      const res = await request(app.getHttpServer())
        .get(`/warehouses/${norteId}/locations`)
        .set("Authorization", bearer(scopedToken))
        .expect(200);

      expect(res.body).toEqual(["B-2"]);
    });

    it("pedir los lotes acotados a un almacén fuera de alcance da 403", async () => {
      const { scopedToken, productId, centralId } = await conAlcanceSoloEnNorte();

      await request(app.getHttpServer())
        .get(`/products/${productId}/lots?warehouseId=${centralId}`)
        .set("Authorization", bearer(scopedToken))
        .expect(403);
    });

    /**
     * Sin `warehouseId` el listado no falla: muestra el producto con el saldo
     * que esa persona PUEDE ver. Un 403 acá escondería que el lote existe;
     * mostrar el total completo filtraría cuánto hay en una bodega ajena.
     */
    it("sin acotar, el saldo se recorta al alcance en vez de fallar", async () => {
      const { scopedToken, productId } = await conAlcanceSoloEnNorte();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(scopedToken))
        .expect(200);

      const body = res.body as { lotCode: string; totalQuantity: string }[];
      // st30 tiene 3 en total (1 en Central + 2 en Norte), pero desde Norte
      // solo se ven 2. Y st10, que vive entero en Central, queda en cero.
      expect(body.find((l) => l.lotCode === "st30")?.totalQuantity).toBe("2");
      expect(body.find((l) => l.lotCode === "st10")?.totalQuantity).toBe("0");
    });
  });
});
