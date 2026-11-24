import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-NOPRICE — sin precio no se vende. Carlos (2026-11-24) encontró
 * «Bistec 10Kg» con «Se vende» marcado y sin precio: la caja la cobraba en
 * $0.00 y aun así descontaba 10,000 g. Lo que pidió:
 *
 * - al agregar una presentación sin precio, se guarda solo para compras;
 * - marcar «Se vende» sin precio, o borrarle el precio a una que se vende, se
 *   rechaza con «Ponle precio a «Bistec 10Kg» para venderla.»;
 * - la caja (y la cotización) rechazan lo vendible sin precio, también el
 *   producto sin precio («si, aplícala también al producto»).
 *
 * Un cero ESCRITO es una decisión, no un olvido: ese sí se vende.
 */
describe("Sin precio no se vende (F10-NOPRICE)", () => {
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

  const bearer = (token: string) => `Bearer ${token}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `noprice-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant sin precio ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastName: "Pérez",
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

  async function createProduct(token: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", bearer(token))
      .send({ sku: `B-${randomUUID().slice(0, 8)}`, name: "Bistec", baseUnit: "unit", ...body })
      .expect(201);
    return res.body as { id: string };
  }

  const createPresentation = (token: string, productId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/products/${productId}/presentations`)
      .set("Authorization", bearer(token))
      .send(body);

  const updatePresentation = (
    token: string,
    productId: string,
    presentationId: string,
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .patch(`/products/${productId}/presentations/${presentationId}`)
      .set("Authorization", bearer(token))
      .send(body);

  /** Una presentación vendible sin precio, como las que ya existen guardadas. */
  async function legacySellableWithoutPrice(tenantId: string, productId: string, name: string) {
    return prisma.withTenantContext(tenantId, (tx) =>
      tx.productPresentation.create({
        data: { tenantId, productId, name, factor: "10", allowFractionalInput: false },
      }),
    );
  }

  /** Entrada confirmada: la venta en cero necesita existencias. */
  async function stockUp(token: string, tenantId: string, productId: string, quantity: number) {
    const warehouse = await prisma.withTenantContext(tenantId, (tx) =>
      tx.warehouse.findFirstOrThrow({ select: { id: true } }),
    );
    const doc = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set("Authorization", bearer(token))
      .send({ type: "entry", warehouseId: warehouse.id })
      .expect(201);
    const docId = (doc.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/inventory/documents/${docId}`)
      .set("Authorization", bearer(token))
      .send({ reasonCode: "invoice", reference: `F-${randomUUID().slice(0, 6)}` })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/inventory/documents/${docId}/lines`)
      .set("Authorization", bearer(token))
      .send({ productId, quantity: quantity, unitCost: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/inventory/documents/${docId}/confirm`)
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);
  }

  const openShift = (token: string) =>
    request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

  const sell = (token: string, lines: Record<string, unknown>[]) =>
    request(app.getHttpServer())
      .post("/pos/sales")
      .set("Authorization", bearer(token))
      .send({ paymentMethod: "cash", lines });

  const messageOf = (res: request.Response) => (res.body as { message: string }).message;

  describe("agregar una presentación", () => {
    it("sin precio, se guarda solo para compras", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });

      const res = await createPresentation(token, steak.id, {
        name: "Bistec 10Kg",
        factor: 10,
      }).expect(201);

      expect(res.body).toMatchObject({ isSellable: false, isPurchasable: true, price: null });
    });

    it("con precio, se guarda como antes: se compra y se vende", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });

      const res = await createPresentation(token, steak.id, {
        name: "Bistec 10Kg",
        factor: 10,
        price: 1500,
      }).expect(201);

      expect(res.body).toMatchObject({ isSellable: true, isPurchasable: true, price: "1500" });
    });

    it("pedir que se venda sin precio se rechaza con el aviso", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });

      const res = await createPresentation(token, steak.id, {
        name: "Bistec 10Kg",
        factor: 10,
        isSellable: true,
      }).expect(422);

      expect(messageOf(res)).toBe("Ponle precio a «Bistec 10Kg» para venderla.");
    });

    it("un cero escrito sí se vende: es una decisión, no un olvido", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });

      const res = await createPresentation(token, steak.id, {
        name: "Muestra",
        factor: 1,
        price: 0,
      }).expect(201);

      expect(res.body).toMatchObject({ isSellable: true, price: "0" });
    });
  });

  describe("editar una presentación", () => {
    it("marcar «Se vende» en una sin precio se rechaza con el aviso", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });
      const bag = (
        await createPresentation(token, steak.id, { name: "Bistec 10Kg", factor: 10 }).expect(201)
      ).body as { id: string };

      const res = await updatePresentation(token, steak.id, bag.id, {
        isSellable: true,
      }).expect(422);

      expect(messageOf(res)).toBe("Ponle precio a «Bistec 10Kg» para venderla.");
    });

    it("borrarle el precio a una que se vende se rechaza con el aviso", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });
      const bag = (
        await createPresentation(token, steak.id, {
          name: "Bistec 10Kg",
          factor: 10,
          price: 1500,
        }).expect(201)
      ).body as { id: string };

      const res = await updatePresentation(token, steak.id, bag.id, { price: null }).expect(422);

      expect(messageOf(res)).toBe("Ponle precio a «Bistec 10Kg» para venderla.");
    });

    it("precio y «Se vende» en el mismo guardado sí se puede", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });
      const bag = (
        await createPresentation(token, steak.id, { name: "Bistec 10Kg", factor: 10 }).expect(201)
      ).body as { id: string };

      const res = await updatePresentation(token, steak.id, bag.id, {
        price: 1500,
        isSellable: true,
      }).expect(200);

      expect(res.body).toMatchObject({ isSellable: true, price: "1500" });
    });

    it("borrar el precio de una que solo se compra sigue igual", async () => {
      const { token } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });
      const bag = (
        await createPresentation(token, steak.id, {
          name: "Bistec 10Kg",
          factor: 10,
          price: 1500,
        }).expect(201)
      ).body as { id: string };
      await updatePresentation(token, steak.id, bag.id, { isSellable: false }).expect(200);

      const res = await updatePresentation(token, steak.id, bag.id, { price: null }).expect(200);

      expect(res.body).toMatchObject({ isSellable: false, price: null });
    });

    it("una vendible sin precio que ya existía se puede editar en otra cosa", async () => {
      const { token, tenantId } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });
      const legacy = await legacySellableWithoutPrice(tenantId, steak.id, "Bistec 10Kg");

      const res = await updatePresentation(token, steak.id, legacy.id, {
        name: "Bolsa 10 kg",
        price: null,
      }).expect(200);

      expect(res.body).toMatchObject({ name: "Bolsa 10 kg", isSellable: true, price: null });
    });
  });

  describe("la caja", () => {
    it("rechaza una presentación vendible sin precio en vez de cobrarla en $0.00", async () => {
      const { token, tenantId } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });
      const legacy = await legacySellableWithoutPrice(tenantId, steak.id, "Bistec 10Kg");
      await stockUp(token, tenantId, steak.id, 100);
      await openShift(token);

      const res = await sell(token, [
        { productId: steak.id, presentationId: legacy.id, quantity: 1 },
      ]).expect(422);

      expect(messageOf(res)).toBe(
        "«Bistec» (Bistec 10Kg) no tiene precio de venta. Ponle precio en Productos para venderlo.",
      );
      // El renglón culpable viaja como dato: la caja lo marca.
      expect((res.body as { sku?: string }).sku).toMatch(/^B-/);
      const sales = await prisma.withTenantContext(tenantId, (tx) => tx.sale.count());
      expect(sales).toBe(0);
    });

    it("rechaza un producto sin precio", async () => {
      const { token, tenantId } = await registerAndLogin();
      const noPrice = await createProduct(token, { name: "Arrachera" });
      await stockUp(token, tenantId, noPrice.id, 10);
      await openShift(token);

      const res = await sell(token, [{ productId: noPrice.id, quantity: 1 }]).expect(422);

      expect(messageOf(res)).toMatch(/^«Arrachera» \(.+\) no tiene precio de venta\./);
    });

    it("un precio en cero escrito a propósito sí se cobra", async () => {
      const { token, tenantId } = await registerAndLogin();
      const sample = await createProduct(token, { name: "Muestra", price: 0 });
      await stockUp(token, tenantId, sample.id, 10);
      await openShift(token);

      const res = await sell(token, [{ productId: sample.id, quantity: 1 }]).expect(201);

      expect((res.body as { total: string }).total).toBe("0");
    });

    it("con precio, cobra como antes", async () => {
      const { token, tenantId } = await registerAndLogin();
      const steak = await createProduct(token, { price: 180 });
      await stockUp(token, tenantId, steak.id, 10);
      await openShift(token);

      const res = await sell(token, [{ productId: steak.id, quantity: 2 }]).expect(201);

      expect((res.body as { total: string }).total).toBe("360");
    });
  });

  it("tampoco se cotiza sin precio", async () => {
    const { token, tenantId } = await registerAndLogin();
    const steak = await createProduct(token, { price: 180 });
    const legacy = await legacySellableWithoutPrice(tenantId, steak.id, "Bistec 10Kg");
    await stockUp(token, tenantId, steak.id, 100);

    const res = await request(app.getHttpServer())
      .post("/pos/quotes")
      .set("Authorization", bearer(token))
      .send({ lines: [{ productId: steak.id, presentationId: legacy.id, quantity: 1 }] })
      .expect(422);

    expect(messageOf(res)).toBe(
      "«Bistec» (Bistec 10Kg) no tiene precio de venta. Ponle precio en Productos para venderlo.",
    );
  });
});
