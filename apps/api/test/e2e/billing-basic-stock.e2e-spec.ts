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
  crearProducto,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F7-E2E-04 — el negocio Basic que vende sin control de inventario, y el día
 * que sube a Pro.
 *
 * ── La decisión de producto ─────────────────────────────────────────────
 *
 * Basic NO tiene control de inventario: es un POS de mostrador para quien
 * todavía no lleva existencias. Ese cliente TIENE que poder cobrar aunque su
 * catálogo diga cero, porque su catálogo no refleja su bodega — nunca la
 * cargó.
 *
 * Y la corrección de Carlos (2026-08-28): vender sin existencias también es
 * un INTERRUPTOR del negocio (`tenants.sell_without_stock`), no solo una
 * consecuencia del plan. Un Pro con inventario puede tener el día en que la
 * mercancía llegó al mostrador antes que el papel. La regla efectiva que
 * este archivo fija es la unión de las dos:
 *
 *     permite negativos  ⟺  ¡plan.stock_control  ∨  tenant.sell_without_stock
 *
 * ── Y por qué el negativo se ASIENTA en vez de esconderse ───────────────
 *
 * La venta descuenta igual y el kardex se escribe igual: el saldo negativo no
 * es un error, es la LISTA de lo que hay que inventariar el día que el
 * negocio suba a un plan con control. Por eso el upgrade la devuelve como
 * `warnings.negativeStock` y un conteo físico la corrige.
 */
describe("Basic vende con stock en cero (F7-E2E-04)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "basic-admin");
    await makePlatformAdmin(app, prisma, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  const vender = (token: string, productId: string, quantity: number) =>
    request(app.getHttpServer())
      .post("/pos/sales")
      .set("Authorization", bearer(token))
      .send({ paymentMethod: "cash", lines: [{ productId, quantity }] });

  const cambiarPlan = (tenantId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/admin/billing/tenants/${tenantId}/subscription`)
      .set("Authorization", bearer(admin.token))
      .send(body);

  const saldo = (tenantId: string, productId: string) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.stockByWarehouse.findFirstOrThrow({ where: { productId }, select: { quantity: true } }),
    );

  /** Un negocio Basic real: contrató y pagó el plan sin control de stock. */
  async function negocioBasic() {
    const negocio = await registerTenant(app, "basic");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    const producto = await crearProducto(app, negocio.token, 25);
    const almacen = await almacenInicial(prisma, negocio.tenantId);

    await request(app.getHttpServer())
      .post(`/admin/billing/tenants/${negocio.tenantId}/payments`)
      .set("Authorization", bearer(admin.token))
      .send({
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        planCode: "basic",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(negocio.token))
      .send({})
      .expect(201);

    return { ...negocio, productId: producto.id, sku: producto.sku, almacen };
  }

  describe("la venta con saldo en cero", () => {
    it("cobra normal y deja el saldo en negativo, con su movimiento en el kardex", async () => {
      const negocio = await negocioBasic();

      await vender(negocio.token, negocio.productId, 3).expect(201);

      expect(Number((await saldo(negocio.tenantId, negocio.productId)).quantity)).toBe(-3);

      // El kardex NO se salta: la historia queda completa, que es justo lo
      // que hace utilizable el negativo el día del inventario.
      const movimientos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.stockMovement.findMany({ where: { productId: negocio.productId } }),
      );
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]?.direction).toBe("exit");
      expect(Number(movimientos[0]?.quantity)).toBe(3);
    });

    it("el plan efectivo lo dice: Basic no controla stock", async () => {
      const negocio = await negocioBasic();

      const me = await request(app.getHttpServer())
        .get("/me")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect((me.body as { subscription: Record<string, unknown> }).subscription).toMatchObject({
        planCode: "basic",
        status: "active",
        writeAccess: true,
        stockControl: false,
      });
    });

    /** Basic vende, pero no administra inventario: los módulos no son suyos. */
    it("Basic no puede abrir un documento de inventario: 402 feature_not_in_plan", async () => {
      const negocio = await negocioBasic();

      const rechazo = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(negocio.token))
        .send({ type: "entry", warehouseId: negocio.almacen })
        .expect(402);

      expect(rechazo.body).toMatchObject({ code: "billing.feature_not_in_plan" });
    });
  });

  describe("el upgrade a Pro dice qué inventariar", () => {
    it("mover a Pro devuelve los negativos con su SKU y su almacén", async () => {
      const negocio = await negocioBasic();
      await vender(negocio.token, negocio.productId, 3).expect(201);

      const upgrade = await cambiarPlan(negocio.tenantId, {
        planCode: "pro",
        reason: "el cliente contrató inventario",
      }).expect(200);

      const body = upgrade.body as {
        warnings: { negativeStock: { sku: string; warehouse: string; quantity: string }[] };
      };
      expect(body.warnings.negativeStock).toHaveLength(1);
      expect(body.warnings.negativeStock[0]).toMatchObject({
        sku: negocio.sku,
        quantity: "-3",
      });
    });

    /** Sin negativos no hay aviso: la lista vacía es una respuesta, no un hueco. */
    it("un Basic que no vendió de más sube a Pro sin avisos", async () => {
      const negocio = await negocioBasic();

      const upgrade = await cambiarPlan(negocio.tenantId, {
        planCode: "pro",
        reason: "upgrade limpio",
      }).expect(200);

      expect(
        (upgrade.body as { warnings: { negativeStock: unknown[] } }).warnings.negativeStock,
      ).toHaveLength(0);
    });

    it("ya en Pro, un conteo físico corrige el negativo", async () => {
      const negocio = await negocioBasic();
      await vender(negocio.token, negocio.productId, 3).expect(201);
      await cambiarPlan(negocio.tenantId, {
        planCode: "pro",
        reason: "el cliente contrató inventario",
      }).expect(200);

      const doc = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(negocio.token))
        .send({ type: "physical_count", warehouseId: negocio.almacen })
        .expect(201);
      const docId = (doc.body as { id: string }).id;
      // Cuenta 12 sobre un teórico de -3. El conteo es ABSOLUTO: lo contado
      // es el saldo nuevo, no un delta que se suma al negativo.
      await request(app.getHttpServer())
        .post(`/inventory/documents/${docId}/lines/import`)
        .set("Authorization", bearer(negocio.token))
        .send({
          file: `sku,lote,caducidad,ubicacion,contado\n${negocio.sku},,,,12`,
          format: "csv",
          mode: "replace",
        })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${docId}/confirm`)
        .set("Authorization", bearer(negocio.token))
        .send({})
        .expect(201);

      expect(Number((await saldo(negocio.tenantId, negocio.productId)).quantity)).toBe(12);

      // Y el kardex cuenta la corrección en dos asientos: el que devuelve el
      // negativo a cero y el que asienta lo contado. Con un teórico POSITIVO
      // el primero sería una salida; con uno negativo es una entrada.
      const movimientos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.stockMovement.findMany({
          where: { productId: negocio.productId, reasonCode: "physical_count" },
          orderBy: { seq: "asc" },
        }),
      );
      expect(movimientos.map((m) => [m.direction, Number(m.quantity)])).toEqual([
        ["entry", 3],
        ["entry", 12],
      ]);

      // Y el aviso desaparece: ya no hay nada que inventariar.
      const revisita = await cambiarPlan(negocio.tenantId, {
        planCode: "pro",
        reason: "revisión post-conteo",
      }).expect(200);
      expect(
        (revisita.body as { warnings: { negativeStock: unknown[] } }).warnings.negativeStock,
      ).toHaveLength(0);
    });
  });

  describe("el interruptor del negocio (corrección de Carlos, 2026-08-28)", () => {
    it("en Pro, sin el interruptor, vender sin existencias se rechaza", async () => {
      const negocio = await negocioBasic();
      await cambiarPlan(negocio.tenantId, { planCode: "pro", reason: "upgrade" }).expect(200);

      const rechazo = await vender(negocio.token, negocio.productId, 1).expect(422);
      expect(rechazo.body).toMatchObject({ code: "inventory.insufficient_stock" });
    });

    /**
     * El mismo Pro, con el interruptor prendido, vuelve a vender: la regla
     * efectiva es la UNIÓN de plan e interruptor, no solo el plan.
     */
    it("con `sellWithoutStock` prendido, el mismo Pro vende y asienta el negativo", async () => {
      const negocio = await negocioBasic();
      await cambiarPlan(negocio.tenantId, { planCode: "pro", reason: "upgrade" }).expect(200);
      await prisma.tenant.update({
        where: { id: negocio.tenantId },
        data: { sellWithoutStock: true },
      });

      await vender(negocio.token, negocio.productId, 2).expect(201);

      expect(Number((await saldo(negocio.tenantId, negocio.productId)).quantity)).toBe(-2);
    });

    /**
     * El interruptor es SOLO de la venta. Una salida de inventario captura lo
     * que ya pasó en la bodega: si el papel dice que salieron más de las que
     * había, el papel está mal y hay que corregirlo, no asentarlo.
     */
    it("el interruptor no afecta a las salidas de inventario: siguen validando", async () => {
      const negocio = await negocioBasic();
      await cambiarPlan(negocio.tenantId, { planCode: "pro", reason: "upgrade" }).expect(200);
      await prisma.tenant.update({
        where: { id: negocio.tenantId },
        data: { sellWithoutStock: true },
      });

      const doc = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(negocio.token))
        .send({ type: "exit", warehouseId: negocio.almacen })
        .expect(201);
      const docId = (doc.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${docId}`)
        .set("Authorization", bearer(negocio.token))
        .send({ reasonCode: "adjustment", reasonNote: "merma" })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${docId}/lines`)
        .set("Authorization", bearer(negocio.token))
        .send({ productId: negocio.productId, quantity: 5 })
        .expect(201);

      const rechazo = await request(app.getHttpServer())
        .post(`/inventory/documents/${docId}/confirm`)
        .set("Authorization", bearer(negocio.token))
        .send({})
        .expect(422);
      expect(rechazo.body).toMatchObject({ code: "inventory.insufficient_stock" });
    });
  });
});
