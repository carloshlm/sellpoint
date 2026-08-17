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

/**
 * F2-PROD / F2-PRESENT / F2-BOM. Cubre el camino completo del catálogo de
 * productos, incluido el ejemplo de Carlos: "1 kg de azúcar alcanza para 50
 * cafés", que se guarda por porción y se calcula contra el stock.
 */
describe("Productos, presentaciones y composición (F2-PROD/PRESENT/BOM)", () => {
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

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant prod ${randomUUID()}`,
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

  const bearer = (token: string) => `Bearer ${token}`;

  function createProduct(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post("/products")
      .set("Authorization", bearer(token))
      .send(body);
  }

  describe("F2-PROD — alta y precio", () => {
    it("el alta crea la presentación base «Unidad ×1» con el precio del formulario", async () => {
      const { token } = await registerAndLogin();

      const created = await createProduct(token, {
        sku: `PAR-${randomUUID().slice(0, 8)}`,
        name: "Paracetamol 500mg",
        baseUnit: "unit",
        price: 15.5,
        cost: 9,
      }).expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/products/${(created.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .expect(200);

      const presentations = (detail.body as { presentations: Record<string, unknown>[] })
        .presentations;
      expect(presentations).toHaveLength(1);
      expect(presentations[0]).toMatchObject({
        name: "Unidad",
        factor: "1",
        isDefaultSale: true,
        price: "15.5",
        cost: "9",
        // `unit` es categoría `count`: no admite decimales.
        allowFractionalInput: false,
      });
    });

    it("una unidad base continua deriva allowFractionalInput en true", async () => {
      const { token } = await registerAndLogin();

      const created = await createProduct(token, {
        sku: `LECHE-${randomUUID().slice(0, 8)}`,
        name: "Leche",
        baseUnit: "ml",
      }).expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/products/${(created.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .expect(200);

      expect(
        (detail.body as { presentations: { allowFractionalInput: boolean }[] }).presentations[0]
          ?.allowFractionalInput,
      ).toBe(true);
    });

    it("editar el precio del producto edita la presentación predeterminada, no crea otra", async () => {
      const { token } = await registerAndLogin();
      const created = await createProduct(token, {
        sku: `SKU-${randomUUID().slice(0, 8)}`,
        name: "Producto",
        price: 10,
      }).expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set("Authorization", bearer(token))
        .send({ price: 22 })
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/products/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);

      const presentations = (detail.body as { presentations: { price: string }[] }).presentations;
      expect(presentations).toHaveLength(1);
      expect(presentations[0]?.price).toBe("22");
    });

    it("un importe con más de dos decimales se rechaza en vez de redondearse solo", async () => {
      // `DECIMAL(14,2)`: sin esta validación Postgres guardaría 15.56 y nadie
      // se enteraría de que el número que se escribió no es el que quedó.
      const { token } = await registerAndLogin();

      await createProduct(token, {
        sku: `DEC-${randomUUID().slice(0, 8)}`,
        name: "Tres decimales",
        price: 15.555,
      }).expect(400);

      const ok = await createProduct(token, {
        sku: `DEC-${randomUUID().slice(0, 8)}`,
        name: "Dos decimales",
        price: 15.55,
        cost: 9.9,
      }).expect(201);

      // La edición cierra la otra mitad de la puerta: sin esto se podría dar de
      // alta bien y ensuciar el precio después.
      await request(app.getHttpServer())
        .patch(`/products/${(ok.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .send({ cost: 0.001 })
        .expect(400);
    });

    it("SKU repetido en el tenant → 409; unidad desconocida → 400", async () => {
      const { token } = await registerAndLogin();
      const sku = `DUP-${randomUUID().slice(0, 8)}`;
      await createProduct(token, { sku, name: "Uno" }).expect(201);

      await createProduct(token, { sku, name: "Otro" }).expect(409);
      await createProduct(token, {
        sku: `X-${randomUUID().slice(0, 8)}`,
        name: "Raro",
        baseUnit: "parsec",
      }).expect(400);
    });

    it("la búsqueda encuentra por SKU, por nombre y por código de barras de una presentación", async () => {
      const { token } = await registerAndLogin();
      const created = await createProduct(token, {
        sku: "IBU-400",
        name: "Ibuprofeno 400mg",
      }).expect(201);
      const id = (created.body as { id: string }).id;
      const barcode = `750${Date.now()}`;

      await request(app.getHttpServer())
        .post(`/products/${id}/presentations`)
        .set("Authorization", bearer(token))
        .send({ name: "Caja 20", factor: 20, barcode })
        .expect(201);

      for (const needle of ["ibu", "Ibuprofeno", barcode]) {
        const found = await request(app.getHttpServer())
          .get(`/products?query=${needle}`)
          .set("Authorization", bearer(token))
          .expect(200);
        expect((found.body as { items: unknown[] }).items).toHaveLength(1);
      }
    });

    it("la lista pagina del lado del server", async () => {
      const { token } = await registerAndLogin();
      for (let index = 0; index < 3; index += 1) {
        await createProduct(token, { sku: `P-${index}`, name: `Producto ${index}` }).expect(201);
      }

      const page = await request(app.getHttpServer())
        .get("/products?page=1&pageSize=2")
        .set("Authorization", bearer(token))
        .expect(200);

      expect(page.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect((page.body as { items: unknown[] }).items).toHaveLength(2);
    });
  });

  describe("F2-PRESENT — presentaciones", () => {
    it("la presentación tampoco acepta importes de tres decimales", async () => {
      // Misma regla, otra puerta: el precio de una presentación va a la misma
      // columna `DECIMAL(14,2)` que el del producto.
      const { token } = await registerAndLogin();
      const product = await createProduct(token, {
        sku: `PDEC-${randomUUID().slice(0, 8)}`,
        name: "Con presentaciones",
      }).expect(201);
      const id = (product.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/products/${id}/presentations`)
        .set("Authorization", bearer(token))
        .send({ name: "Caja", factor: 10, price: 199.999 })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/products/${id}/presentations`)
        .set("Authorization", bearer(token))
        .send({ name: "Caja", factor: 10, price: 199.99 })
        .expect(201);
    });

    it("el barcode es único por tenant y el nombre único por producto", async () => {
      const { token } = await registerAndLogin();
      const first = await createProduct(token, { sku: "A", name: "A" }).expect(201);
      const second = await createProduct(token, { sku: "B", name: "B" }).expect(201);
      const barcode = `999${Date.now()}`;

      await request(app.getHttpServer())
        .post(`/products/${(first.body as { id: string }).id}/presentations`)
        .set("Authorization", bearer(token))
        .send({ name: "Caja", factor: 10, barcode })
        .expect(201);

      // Mismo barcode en OTRO producto del mismo tenant: rechazado.
      await request(app.getHttpServer())
        .post(`/products/${(second.body as { id: string }).id}/presentations`)
        .set("Authorization", bearer(token))
        .send({ name: "Caja", factor: 10, barcode })
        .expect(409);

      // Mismo nombre en el MISMO producto: rechazado.
      await request(app.getHttpServer())
        .post(`/products/${(first.body as { id: string }).id}/presentations`)
        .set("Authorization", bearer(token))
        .send({ name: "Caja", factor: 5 })
        .expect(409);
    });

    it("marcar una presentación como predeterminada desmarca la anterior", async () => {
      const { token } = await registerAndLogin();
      const product = await createProduct(token, { sku: "C", name: "C" }).expect(201);
      const id = (product.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/products/${id}/presentations`)
        .set("Authorization", bearer(token))
        .send({ name: "Caja", factor: 10, isDefaultSale: true })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get(`/products/${id}/presentations`)
        .set("Authorization", bearer(token))
        .expect(200);

      const defaults = (list.body as { isDefaultSale: boolean }[]).filter(
        (presentation) => presentation.isDefaultSale,
      );
      expect(defaults).toHaveLength(1);
    });

    it("no se puede dejar al producto SIN presentación predeterminada", async () => {
      const { token } = await registerAndLogin();
      const product = await createProduct(token, { sku: "D", name: "D" }).expect(201);
      const id = (product.body as { id: string }).id;
      const list = await request(app.getHttpServer())
        .get(`/products/${id}/presentations`)
        .set("Authorization", bearer(token))
        .expect(200);
      const base = (list.body as { id: string }[])[0];

      await request(app.getHttpServer())
        .patch(`/products/${id}/presentations/${base?.id}`)
        .set("Authorization", bearer(token))
        .send({ isDefaultSale: false })
        .expect(409);
    });
  });

  describe("F2-BOM — composición", () => {
    /** El ejemplo de Carlos: azúcar (en gr) que alcanza para N cafés. */
    async function setupCafe(token: string, tenantId: string) {
      const azucar = await createProduct(token, {
        sku: `AZU-${randomUUID().slice(0, 8)}`,
        name: "Azúcar",
        baseUnit: "gr",
        cost: 40,
      }).expect(201);
      const cafe = await createProduct(token, {
        sku: `CAF-${randomUUID().slice(0, 8)}`,
        name: "Café Regular",
        isComposite: true,
      }).expect(201);

      const azucarId = (azucar.body as { id: string }).id;
      const cafeId = (cafe.body as { id: string }).id;

      // "1 kg alcanza para 50 cafés" → cada café lleva 20 gr.
      await request(app.getHttpServer())
        .post(`/products/${cafeId}/composition`)
        .set("Authorization", bearer(token))
        .send({ lines: [{ componentId: azucarId, quantity: 20 }] })
        .expect(200);

      // 1 kg de azúcar en stock (F3 lo va a mover; acá se siembra).
      const warehouse = await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.create({ data: { tenantId, name: `Central ${randomUUID()}` } }),
      );
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.create({
          data: { tenantId, productId: azucarId, warehouseId: warehouse.id, quantity: 1000 },
        }),
      );

      return { azucarId, cafeId };
    }

    it("«alcanza para N» se CALCULA contra el stock, con su componente limitante", async () => {
      const { token, tenantId } = await registerAndLogin();
      const { azucarId, cafeId } = await setupCafe(token, tenantId);

      const availability = await request(app.getHttpServer())
        .get(`/products/${cafeId}/availability`)
        .set("Authorization", bearer(token))
        .expect(200);

      // 1000 gr ÷ 20 gr = 50 cafés. Exactamente el ejemplo de Carlos.
      expect(availability.body).toMatchObject({
        units: 50,
        limitedBy: { productId: azucarId, name: "Azúcar" },
      });
    });

    it("la merma reduce las unidades armables", async () => {
      const { token, tenantId } = await registerAndLogin();
      const { azucarId, cafeId } = await setupCafe(token, tenantId);

      // 25% de merma: cada café consume 25 gr efectivos → 40 unidades.
      await request(app.getHttpServer())
        .post(`/products/${cafeId}/composition`)
        .set("Authorization", bearer(token))
        .send({ lines: [{ componentId: azucarId, quantity: 20, wastePercentage: 25 }] })
        .expect(200);

      const availability = await request(app.getHttpServer())
        .get(`/products/${cafeId}/availability`)
        .set("Authorization", bearer(token))
        .expect(200);

      expect(availability.body).toMatchObject({ units: 40 });
    });

    it("el costo estimado sale del costo por unidad base del componente", async () => {
      const { token, tenantId } = await registerAndLogin();
      const { cafeId } = await setupCafe(token, tenantId);

      const estimate = await request(app.getHttpServer())
        .get(`/products/${cafeId}/cost-estimate`)
        .set("Authorization", bearer(token))
        .expect(200);

      // La presentación base del azúcar cuesta 40 con factor 1 (gr) → 40/gr;
      // 20 gr por café = 800.
      expect(estimate.body).toMatchObject({ total: "800.00" });
    });

    it("un ciclo INDIRECTO se rechaza nombrando el camino", async () => {
      const { token } = await registerAndLogin();
      const a = await createProduct(token, { sku: "CA", name: "A" }).expect(201);
      const b = await createProduct(token, { sku: "CB", name: "B" }).expect(201);
      const aId = (a.body as { id: string }).id;
      const bId = (b.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/products/${aId}/composition`)
        .set("Authorization", bearer(token))
        .send({ lines: [{ componentId: bId, quantity: 1 }] })
        .expect(200);

      // B lleva A cerraría el círculo: el CHECK de la DB no lo ve, el DFS sí.
      const blocked = await request(app.getHttpServer())
        .post(`/products/${bId}/composition`)
        .set("Authorization", bearer(token))
        .send({ lines: [{ componentId: aId, quantity: 1 }] })
        .expect(409);

      expect(blocked.body).toMatchObject({
        message: expect.stringContaining("products.composition_cycle"),
      });
    });

    it("borrar un producto que es COMPONENTE de otro se bloquea diciendo quién lo usa", async () => {
      const { token, tenantId } = await registerAndLogin();
      const { azucarId } = await setupCafe(token, tenantId);

      const blocked = await request(app.getHttpServer())
        .delete(`/products/${azucarId}`)
        .set("Authorization", bearer(token))
        .expect(409);

      expect(blocked.body).toMatchObject({
        message: expect.stringContaining("products.is_component"),
      });
    });

    it("cambiar la unidad base de un componente de otro producto se bloquea", async () => {
      const { token, tenantId } = await registerAndLogin();
      const { azucarId } = await setupCafe(token, tenantId);

      await request(app.getHttpServer())
        .patch(`/products/${azucarId}`)
        .set("Authorization", bearer(token))
        .send({ baseUnit: "kg" })
        .expect(409);
    });
  });
});
