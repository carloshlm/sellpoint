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
import { startTestApp } from "./support/start-test-app";

/**
 * F3-GUARDS — las cinco puertas que F2 dejó documentadas como "F3 lo completa".
 *
 * Todas comparten un criterio: **con historia detrás, no se borra ni se
 * reescribe**. Un producto que se movió, una presentación con la que alguien
 * capturó, un almacén con saldo — el histórico los referencia y borrarlos
 * dejaría un kardex que no se puede explicar. Siempre hay una alternativa no
 * destructiva (desactivar) y el error la nombra.
 */
describe("Guardas de integridad (F3-GUARDS)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";

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

  const bearer = (t: string) => `Bearer ${t}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant guards ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
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

    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  /** Un producto y un almacén, con un helper para moverle stock de verdad. */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();
    const auth = () => ({ Authorization: bearer(token) });
    const stamp = randomUUID().slice(0, 6);

    const creado = await request(app.getHttpServer())
      .post("/products")
      .set(auth())
      .send({ sku: `GD-${stamp}`, name: "Con historia", baseUnit: "unit" })
      .expect(201);
    const productId = (creado.body as { id: string }).id;

    const { warehouseId, otroId } = await prisma.withTenantContext(tenantId, async (tx) => {
      const [a, b] = await Promise.all([
        tx.warehouse.create({ data: { tenantId, name: `Central ${stamp}` } }),
        tx.warehouse.create({ data: { tenantId, name: `Norte ${stamp}` } }),
      ]);
      return { warehouseId: a.id, otroId: b.id };
    });

    async function mover(
      type: "entry" | "exit",
      lineas: Record<string, unknown>[],
      warehouse = warehouseId,
      header: Record<string, unknown> = { reasonCode: "adjustment", reasonNote: "prueba" },
    ) {
      const doc = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type, warehouseId: warehouse })
        .expect(201);
      const id = (doc.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send(header)
        .expect(200);
      for (const linea of lineas) {
        await request(app.getHttpServer())
          .post(`/inventory/documents/${id}/lines`)
          .set(auth())
          .send(linea)
          .expect(201);
      }
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set(auth())
        .send({})
        .expect(201);
    }

    return { token, tenantId, productId, warehouseId, otroId, mover, auth };
  }

  describe("F3-GUARDS-01 — una presentación con la que ya se capturó", () => {
    it("no se borra si tiene movimientos, y se dice qué hacer", async () => {
      const { productId, mover, auth } = await escenario();
      const presentacion = await request(app.getHttpServer())
        .post(`/products/${productId}/presentations`)
        .set(auth())
        .send({ name: "Caja ×12", factor: 12 })
        .expect(201);
      const presentationId = (presentacion.body as { id: string }).id;

      await mover("entry", [{ productId, presentationId, quantity: 2 }]);

      const res = await request(app.getHttpServer())
        .delete(`/products/${productId}/presentations/${presentationId}`)
        .set(auth())
        .expect(409);

      expect((res.body as { code: string }).code).toBe("products.presentation_in_use");
      // El mensaje nombra la salida no destructiva: el kardex tiene que poder
      // seguir explicando en qué presentación se capturó cada línea.
      expect((res.body as { message: string }).message).toMatch(/desactív/i);
    });

    it("sin movimientos sí se borra", async () => {
      const { productId, auth } = await escenario();
      const presentacion = await request(app.getHttpServer())
        .post(`/products/${productId}/presentations`)
        .set(auth())
        .send({ name: "Caja ×6", factor: 6 })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/products/${productId}/presentations/${(presentacion.body as { id: string }).id}`)
        .set(auth())
        .expect(204);
    });

    /** Desactivar sigue siendo el camino: no borra historia. */
    it("con movimientos igual se puede DESACTIVAR", async () => {
      const { productId, mover, auth } = await escenario();
      const presentacion = await request(app.getHttpServer())
        .post(`/products/${productId}/presentations`)
        .set(auth())
        .send({ name: "Caja ×24", factor: 24 })
        .expect(201);
      const presentationId = (presentacion.body as { id: string }).id;
      await mover("entry", [{ productId, presentationId, quantity: 1 }]);

      await request(app.getHttpServer())
        .patch(`/products/${productId}/presentations/${presentationId}`)
        .set(auth())
        .send({ isActive: false })
        .expect(200);
    });
  });

  describe("F3-GUARDS-02 — un producto que ya se movió", () => {
    it("no se borra", async () => {
      const { productId, mover, auth } = await escenario();
      await mover("entry", [{ productId, quantity: 10 }]);

      const res = await request(app.getHttpServer())
        .delete(`/products/${productId}`)
        .set(auth())
        .expect(409);

      expect((res.body as { code: string }).code).toBe("products.has_movements");
    });

    /**
     * La unidad base no cambia aunque el saldo esté en cero: el histórico
     * quedó escrito EN esa unidad, y reinterpretarlo cambiaría números ya
     * asentados.
     */
    it("no le cambia la unidad base ni con saldo en cero", async () => {
      const { productId, mover, auth } = await escenario();
      await mover("entry", [{ productId, quantity: 10 }]);
      await mover("exit", [{ productId, quantity: 10 }]);

      const res = await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .set(auth())
        .send({ baseUnit: "kg" })
        .expect(409);

      expect((res.body as { code: string }).code).toBe("products.base_unit_locked_by_movements");
    });

    it("un producto sin historia sí se borra", async () => {
      const { auth } = await escenario();
      const otro = await request(app.getHttpServer())
        .post("/products")
        .set(auth())
        .send({ sku: `LIB-${randomUUID().slice(0, 6)}`, name: "Sin historia" })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/products/${(otro.body as { id: string }).id}`)
        .set(auth())
        .expect(204);
    });

    /** Un lote también es historia: alguien registró esa partida. */
    it("un producto con lotes tampoco se borra", async () => {
      const { tenantId, auth } = await escenario();
      const conLotes = await request(app.getHttpServer())
        .post("/products")
        .set(auth())
        .send({ sku: `LT-${randomUUID().slice(0, 6)}`, name: "Con lote", tracksLots: true })
        .expect(201);
      const id = (conLotes.body as { id: string }).id;
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.productLot.create({ data: { tenantId, productId: id, lotCode: "l1" } }),
      );

      await request(app.getHttpServer()).delete(`/products/${id}`).set(auth()).expect(409);
    });
  });

  describe("F3-GUARDS-03 — un almacén con stock o con traspasos abiertos", () => {
    it("no se desactiva con saldo, y el error dice cuánto hay", async () => {
      const { warehouseId, productId, mover, auth } = await escenario();
      await mover("entry", [{ productId, quantity: 10 }]);

      const res = await request(app.getHttpServer())
        .patch(`/warehouses/${warehouseId}`)
        .set(auth())
        .send({ isActive: false })
        .expect(409);

      expect((res.body as { code: string }).code).toBe("warehouses.has_stock");
      // Con el total en el payload, quien lo intenta sabe cuánto tiene que
      // mover antes de poder cerrarlo.
      expect(Number((res.body as { total: string }).total)).toBe(10);
      // Y el MENSAJE lo dice interpolado: el filter solo rellena placeholders
      // desde `args`, y este total viajaba suelto — la pantalla mostraba
      // «{total}» crudo (captura de Carlos, 2026-08-25).
      const message = (res.body as { message: string }).message;
      expect(message).toContain("10");
      expect(message).not.toContain("{total}");
    });

    it("tras vaciarlo sí se desactiva", async () => {
      const { warehouseId, productId, mover, auth } = await escenario();
      await mover("entry", [{ productId, quantity: 10 }]);
      await mover("exit", [{ productId, quantity: 10 }]);

      await request(app.getHttpServer())
        .patch(`/warehouses/${warehouseId}`)
        .set(auth())
        .send({ isActive: false })
        .expect(200);
    });

    /**
     * Un almacén DESTINO de un traspaso en tránsito no se puede cerrar: hay
     * mercancía en camino que nadie podría recibir.
     */
    it("no se desactiva el destino de un traspaso en tránsito", async () => {
      const { warehouseId, otroId, productId, mover, auth } = await escenario();
      await mover("entry", [{ productId, quantity: 10 }]);
      await mover("exit", [{ productId, quantity: 10 }], warehouseId, {
        reasonCode: "transfer",
        linkedWarehouseId: otroId,
      });

      const res = await request(app.getHttpServer())
        .patch(`/warehouses/${otroId}`)
        .set(auth())
        .send({ isActive: false })
        .expect(409);

      expect((res.body as { code: string }).code).toBe("warehouses.has_transfers_in_transit");
    });

    /**
     * El criterio del módulo: la UI muestra la guarda ANTES del clic. Para eso
     * el listado tiene que traer el motivo por el que un almacén no se puede
     * cerrar; si no, la única forma de enterarse es chocando con el 409.
     *
     * Es UN campo y no dos banderas a propósito: cuando hay saldo Y traspasos,
     * `update` corta en el saldo, así que dos banderas describirían un orden
     * que la guarda no respeta. El campo dice exactamente lo que va a pasar.
     */
    it("el listado anticipa el motivo del bloqueo", async () => {
      const { warehouseId, otroId, productId, mover, auth } = await escenario();

      const vacios = await request(app.getHttpServer()).get("/warehouses").set(auth()).expect(200);
      for (const w of vacios.body as { deactivationBlockedBy: string | null }[]) {
        expect(w.deactivationBlockedBy).toBeNull();
      }

      await mover("entry", [{ productId, quantity: 10 }]);
      await mover("exit", [{ productId, quantity: 4 }], warehouseId, {
        reasonCode: "transfer",
        linkedWarehouseId: otroId,
      });

      const res = await request(app.getHttpServer()).get("/warehouses").set(auth()).expect(200);
      const porId = new Map(
        (res.body as { id: string; deactivationBlockedBy: string | null }[]).map((w) => [
          w.id,
          w.deactivationBlockedBy,
        ]),
      );

      // Origen: le quedan 6 adentro.
      expect(porId.get(warehouseId)).toBe("stock");
      // Destino: vacío todavía, pero con mercancía en camino.
      expect(porId.get(otroId)).toBe("transfers_in_transit");
    });
  });

  describe("F3-GUARDS-04 — la moneda del tenant se congela al operar", () => {
    it("un tenant recién creado todavía puede cambiarla", async () => {
      const { auth } = await escenario();

      await request(app.getHttpServer())
        .patch("/tenants/me")
        .set(auth())
        .send({ currency: "USD" })
        .expect(200);
    });

    /**
     * Con un movimiento asentado, la moneda queda fija: los importes ya
     * escritos no tienen unidad propia, la heredan del tenant. Cambiarla
     * reinterpretaría toda la historia.
     */
    it("con un movimiento asentado ya no", async () => {
      const { productId, mover, auth } = await escenario();
      await mover("entry", [{ productId, quantity: 10 }]);

      await request(app.getHttpServer())
        .patch("/tenants/me")
        .set(auth())
        .send({ currency: "USD" })
        .expect(403);
    });
  });

  describe("F3-GUARDS-05 — las unidades armables respetan el alcance", () => {
    it("un Manager de un almacén ve las que puede armar con SU stock", async () => {
      const { token, tenantId, productId, warehouseId, otroId, mover } = await escenario();
      const auth = () => ({ Authorization: bearer(token) });

      const compuesto = await request(app.getHttpServer())
        .post("/products")
        .set(auth())
        .send({ sku: `KIT-${randomUUID().slice(0, 6)}`, name: "Kit", isComposite: true })
        .expect(201);
      const kitId = (compuesto.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/products/${kitId}/composition`)
        .set(auth())
        .send({ lines: [{ componentId: productId, quantity: 5 }] })
        .expect(200);

      // 10 en cada almacén: 20 en total, 2 kits armables por almacén.
      await mover("entry", [{ productId, quantity: 10 }], warehouseId);
      await mover("entry", [{ productId, quantity: 10 }], otroId);

      const tokenService = app.get(TokenService);
      const userId = await prisma.withTenantContext(tenantId, async (tx) => {
        const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
        await tx.userWarehouseScope.create({
          data: { userId: owner.id, warehouseId, tenantId },
        });
        return owner.id;
      });
      const scoped = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["products:read", "inventory:read"],
        locale: "es",
      });

      const conAlcance = await request(app.getHttpServer())
        .get(`/products/${kitId}/availability`)
        .set("Authorization", bearer(scoped))
        .expect(200);
      const sinAlcance = await request(app.getHttpServer())
        .get(`/products/${kitId}/availability`)
        .set(auth())
        .expect(200);

      // Con alcance en UN almacén ve 2; el Admin, que ve todo, ve 4.
      expect((conAlcance.body as { units: number }).units).toBe(2);
      expect((sinAlcance.body as { units: number }).units).toBe(4);
    });
  });
});
