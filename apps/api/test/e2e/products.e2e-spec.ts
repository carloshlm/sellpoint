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
    it("el alta crea la presentación base «Pieza ×1» con el precio del formulario", async () => {
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
        name: "Pieza",
        factor: "1",
        isDefaultSale: true,
        price: "15.5",
        cost: "9",
        // `unit` es categoría `count`: no admite decimales.
        allowFractionalInput: false,
      });
    });

    it("la presentación base se llama como su UNIDAD, no «Pieza» a secas", async () => {
      // Carlos vio una presentación llamada "Unidad" en un producto medido en
      // gramos: valía 1 gramo y el nombre no lo decía.
      const { token } = await registerAndLogin();
      const created = await createProduct(token, {
        sku: `AZU-${randomUUID().slice(0, 8)}`,
        name: "Azúcar",
        baseUnit: "gr",
        price: 0.02,
      }).expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/products/${(created.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .expect(200);

      expect((detail.body as { presentations: { name: string }[] }).presentations[0]?.name).toBe(
        "Gramo",
      );
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

    it("un importe que no cabe en la columna se rechaza diciendo que es GRANDE, no que tiene decimales", async () => {
      // `DECIMAL(14,2)` son 12 enteros: pasarse no se redondea callado como los
      // decimales, lo lanza Postgres como overflow crudo. Y el motivo importa:
      // decir "2 decimales" mandaría a mirar el lugar equivocado.
      const { token } = await registerAndLogin();

      const tooBig = await createProduct(token, {
        sku: `BIG-${randomUUID().slice(0, 8)}`,
        name: "Un billón",
        price: 1000000000000,
      }).expect(400);
      expect(tooBig.body.errors[0]).toMatchObject({
        key: "price",
        code: "products.amount_too_large",
      });

      // El máximo exacto sí entra: el límite es inclusivo.
      await createProduct(token, {
        sku: `MAX-${randomUUID().slice(0, 8)}`,
        name: "El máximo",
        price: 999999999999.99,
      }).expect(201);
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

    /**
     * Borrado y desactivación (decisión de Carlos, 2026-08-17). Una presentación
     * mal cargada —factor equivocado, nombre repetido— se borra de verdad
     * mientras nadie la haya usado. Lo que NO se puede es dejar al producto sin
     * una presentación de venta preseleccionada: el POS de F4 no sabría qué
     * ofrecer, y ese agujero se entra por tres puertas distintas.
     */
    describe("F2-PRESENT — borrar y desactivar", () => {
      async function productWithTwo(token: string) {
        const product = await createProduct(token, {
          sku: `DEL-${randomUUID().slice(0, 8)}`,
          name: "Con presentaciones",
          price: 10,
        }).expect(201);
        const id = (product.body as { id: string }).id;

        const extra = await request(app.getHttpServer())
          .post(`/products/${id}/presentations`)
          .set("Authorization", bearer(token))
          .send({ name: "Bolsa 1 kg", factor: 1000, price: 100 })
          .expect(201);

        return { id, extraId: (extra.body as { id: string }).id };
      }

      it("una presentación que nadie usó se borra de verdad", async () => {
        const { token } = await registerAndLogin();
        const { id, extraId } = await productWithTwo(token);

        await request(app.getHttpServer())
          .delete(`/products/${id}/presentations/${extraId}`)
          .set("Authorization", bearer(token))
          .expect(204);

        const detail = await request(app.getHttpServer())
          .get(`/products/${id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        // Desaparece de verdad: no queda inactiva ensuciando la lista.
        expect((detail.body as { presentations: unknown[] }).presentations).toHaveLength(1);
      });

      it("la PREDETERMINADA no se borra sin nombrar otra antes", async () => {
        const { token } = await registerAndLogin();
        const { id } = await productWithTwo(token);
        const detail = await request(app.getHttpServer())
          .get(`/products/${id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        const base = (
          detail.body as { presentations: { id: string; isDefaultSale: boolean }[] }
        ).presentations.find((item) => item.isDefaultSale);

        const blocked = await request(app.getHttpServer())
          .delete(`/products/${id}/presentations/${base?.id}`)
          .set("Authorization", bearer(token))
          .expect(409);

        expect(blocked.body).toMatchObject({ code: "products.default_presentation_required" });
      });

      it("tampoco se DESACTIVA la predeterminada: es el mismo agujero por otra puerta", async () => {
        // El API ya bloqueaba quitarle la marca de default. Desactivarla dejaba
        // al producto igual de huérfano y pasaba sin chistar.
        const { token } = await registerAndLogin();
        const { id } = await productWithTwo(token);
        const detail = await request(app.getHttpServer())
          .get(`/products/${id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        const base = (
          detail.body as { presentations: { id: string; isDefaultSale: boolean }[] }
        ).presentations.find((item) => item.isDefaultSale);

        const blocked = await request(app.getHttpServer())
          .patch(`/products/${id}/presentations/${base?.id}`)
          .set("Authorization", bearer(token))
          .send({ isActive: false })
          .expect(409);

        expect(blocked.body).toMatchObject({ code: "products.default_presentation_required" });
      });

      it("la ÚLTIMA presentación no se borra: el producto quedaría sin cómo venderse", async () => {
        const { token } = await registerAndLogin();
        const product = await createProduct(token, {
          sku: `SOLO-${randomUUID().slice(0, 8)}`,
          name: "Una sola",
          price: 5,
        }).expect(201);
        const id = (product.body as { id: string }).id;
        const detail = await request(app.getHttpServer())
          .get(`/products/${id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        const only = (detail.body as { presentations: { id: string }[] }).presentations[0];

        await request(app.getHttpServer())
          .delete(`/products/${id}/presentations/${only?.id}`)
          .set("Authorization", bearer(token))
          .expect(409);
      });

      it("borrar una presentación de OTRO producto no se puede: 404", async () => {
        const { token } = await registerAndLogin();
        const { extraId } = await productWithTwo(token);
        const otro = await createProduct(token, {
          sku: `OTRO-${randomUUID().slice(0, 8)}`,
          name: "Otro",
        }).expect(201);

        await request(app.getHttpServer())
          .delete(`/products/${(otro.body as { id: string }).id}/presentations/${extraId}`)
          .set("Authorization", bearer(token))
          .expect(404);
      });
    });

    it("el orden de la tabla NO cambia al editar: dos presentaciones con el mismo factor empatan", async () => {
      // Carlos vio saltar las filas al tocar un checkbox. `ORDER BY factor` a
      // secas no define nada cuando hay empate —sus dos bolsas quedaron en 1000
      // por un error de carga— y Postgres devuelve el orden que le convenga,
      // que cambia después de un UPDATE porque la fila se reubica en el heap.
      const { token, tenantId } = await registerAndLogin();
      const product = await createProduct(token, {
        sku: `ORD-${randomUUID().slice(0, 8)}`,
        name: "Con empate",
        price: 1,
      }).expect(201);
      const id = (product.body as { id: string }).id;

      // Se insertan con `createMany` en UNA sentencia: el `now()` de Postgres
      // es el de la transacción, así que las dos comparten `created_at` al
      // microsegundo —igual que las que crea la importación masiva— y el
      // desempate tiene que caer en el `id`. Los ids se fijan a mano en orden
      // INVERSO al de inserción: sin desempate el motor devuelve el orden del
      // heap (el de inserción) y este test falla, que es justo lo que se quiere.
      const primerId = `1${randomUUID().slice(1)}`;
      const segundoId = `2${randomUUID().slice(1)}`;
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.productPresentation.createMany({
          data: [
            {
              id: segundoId,
              tenantId,
              productId: id,
              name: "Bolsa 2 kg",
              factor: 1000,
              allowFractionalInput: true,
            },
            {
              id: primerId,
              tenantId,
              productId: id,
              name: "Bolsa 1 kg",
              factor: 1000,
              allowFractionalInput: true,
            },
          ],
        }),
      );

      const names = async () => {
        const detail = await request(app.getHttpServer())
          .get(`/products/${id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        return (detail.body as { presentations: { name: string }[] }).presentations.map(
          (item) => item.name,
        );
      };

      const before = await names();
      expect(before).toEqual(["Pieza", "Bolsa 1 kg", "Bolsa 2 kg"]);

      const detail = await request(app.getHttpServer())
        .get(`/products/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);
      const first = (detail.body as { presentations: { id: string; name: string }[] })
        .presentations[1];

      await request(app.getHttpServer())
        .patch(`/products/${id}/presentations/${first?.id}`)
        .set("Authorization", bearer(token))
        .send({ isPurchasable: false })
        .expect(200);

      // La fila editada se queda donde estaba.
      expect(await names()).toEqual(before);

      // El endpoint dedicado ordena igual: si divergieran, la tabla saltaría
      // según qué pantalla la haya cargado.
      const listed = await request(app.getHttpServer())
        .get(`/products/${id}/presentations`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect((listed.body as { name: string }[]).map((item) => item.name)).toEqual(before);
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
        code: "products.composition_cycle",
      });
    });

    it("una merma fuera de rango dice QUÉ campo y CUÁL es el límite, en el idioma del usuario", async () => {
      // El caso exacto que Carlos vio: escribió 1000 en Merma % y el formulario
      // le devolvió `products.invalid_body`, sin campo ni motivo.
      const { token, tenantId } = await registerAndLogin();
      const { cafeId, azucarId } = await setupCafe(token, tenantId);

      const es = await request(app.getHttpServer())
        .post(`/products/${cafeId}/composition`)
        .set("Authorization", bearer(token))
        .set("Accept-Language", "es")
        .send({ lines: [{ componentId: azucarId, quantity: 20, wastePercentage: 1000 }] })
        .expect(400);

      expect(es.body.errors).toEqual([
        {
          // La ruta completa: el formulario sabe qué fila pintar.
          key: "lines.0.wastePercentage",
          code: "validation.max",
          message: "Debe ser 100 o menos.",
        },
      ]);

      // En un request AUTENTICADO el idioma sale del claim `locale` del JWT y
      // NO del header (cascada de `i18n/request-locale.ts`): mandar
      // `Accept-Language: en` con el token de una cuenta en español seguiría
      // devolviendo español, y el test pasaría por el motivo equivocado.
      expect(es.body.errors[0].message).not.toContain("{max}");
    });

    it("borrar un producto que es COMPONENTE de otro se bloquea diciendo quién lo usa", async () => {
      const { token, tenantId } = await registerAndLogin();
      const { azucarId } = await setupCafe(token, tenantId);

      const blocked = await request(app.getHttpServer())
        .delete(`/products/${azucarId}`)
        .set("Authorization", bearer(token))
        .expect(409);

      expect(blocked.body).toMatchObject({
        code: "products.is_component",
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

  /**
   * F3-LOTS-01 — el opt-in por producto al control de lote y caducidad.
   *
   * **Encender siempre se puede; apagar con saldo por lote, no.** La asimetría
   * es a propósito: al encenderlo, el saldo previo queda "sin lote" y se
   * asigna después por inventario físico. Al apagarlo con saldo, en cambio,
   * las filas de `stock_lots` quedarían huérfanas y se rompería la invariante
   * `Σ stock_lots == stock_by_warehouse` que el ledger sostiene.
   */
  describe("F3-LOTS-01 — control por lote", () => {
    async function crearConLotes(token: string) {
      const created = await createProduct(token, {
        sku: `LOT-${randomUUID().slice(0, 8)}`,
        name: "Suero con caducidad",
        baseUnit: "unit",
        tracksLots: true,
      }).expect(201);
      return (created.body as { id: string }).id;
    }

    it("un producto nace SIN control de lote salvo que se pida", async () => {
      const { token } = await registerAndLogin();

      const created = await createProduct(token, {
        sku: `NL-${randomUUID().slice(0, 8)}`,
        name: "Sin lotes",
        baseUnit: "unit",
      }).expect(201);

      expect((created.body as { tracksLots: boolean }).tracksLots).toBe(false);
    });

    it("se puede crear ya con control de lote", async () => {
      const { token } = await registerAndLogin();

      const id = await crearConLotes(token);
      const detail = await request(app.getHttpServer())
        .get(`/products/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);

      expect((detail.body as { tracksLots: boolean }).tracksLots).toBe(true);
    });

    it("encenderlo sobre un producto que ya existía siempre se puede", async () => {
      const { token } = await registerAndLogin();
      const created = await createProduct(token, {
        sku: `ON-${randomUUID().slice(0, 8)}`,
        name: "Se enciende después",
        baseUnit: "unit",
      }).expect(201);
      const id = (created.body as { id: string }).id;

      const updated = await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set("Authorization", bearer(token))
        .send({ tracksLots: true })
        .expect(200);

      expect((updated.body as { tracksLots: boolean }).tracksLots).toBe(true);
    });

    it("apagarlo SIN saldo por lote se puede", async () => {
      const { token } = await registerAndLogin();
      const id = await crearConLotes(token);

      const updated = await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set("Authorization", bearer(token))
        .send({ tracksLots: false })
        .expect(200);

      expect((updated.body as { tracksLots: boolean }).tracksLots).toBe(false);
    });

    it("apagarlo CON saldo por lote da 409 y dice cuánto hay en cada lote", async () => {
      const { token, tenantId } = await registerAndLogin();
      const id = await crearConLotes(token);

      await prisma.withTenantContext(tenantId, async (tx) => {
        const warehouse = await tx.warehouse.create({
          data: { tenantId, name: `Central lots ${randomUUID().slice(0, 8)}` },
        });
        const lot = await tx.productLot.create({
          data: { tenantId, productId: id, lotCode: "st10", expiresAt: new Date("2026-07-01") },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId: warehouse.id, quantity: 7 },
        });
      });

      const rejected = await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set("Authorization", bearer(token))
        .send({ tracksLots: false })
        .expect(409);

      const body = rejected.body as {
        message: string;
        lots?: { lotCode: string; quantity: string }[];
      };
      expect(body.message).toContain("lote");
      // El payload dice DÓNDE está el saldo: sin eso, "no se puede apagar" deja
      // a quien lo intenta sin saber qué mover para poder hacerlo.
      expect(body.lots).toEqual([expect.objectContaining({ lotCode: "st10", quantity: "7" })]);
    });

    /** Un lote agotado no bloquea: lo que estorba es el SALDO, no el registro. */
    it("un lote en cero no impide apagarlo", async () => {
      const { token, tenantId } = await registerAndLogin();
      const id = await crearConLotes(token);

      await prisma.withTenantContext(tenantId, async (tx) => {
        const warehouse = await tx.warehouse.create({
          data: { tenantId, name: `Vacío ${randomUUID().slice(0, 8)}` },
        });
        const lot = await tx.productLot.create({
          data: { tenantId, productId: id, lotCode: "agotado" },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId: warehouse.id, quantity: 0 },
        });
      });

      await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set("Authorization", bearer(token))
        .send({ tracksLots: false })
        .expect(200);
    });

    /**
     * El formulario necesita saber si el checkbox va deshabilitado ANTES de
     * que el usuario lo intente: un 409 después es explicar tarde algo que la
     * pantalla podía haber dicho de entrada.
     */
    it("el detalle dice si hay saldo por lote (`hasLotStock`)", async () => {
      const { token, tenantId } = await registerAndLogin();
      const id = await crearConLotes(token);

      const sinSaldo = await request(app.getHttpServer())
        .get(`/products/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect((sinSaldo.body as { hasLotStock: boolean }).hasLotStock).toBe(false);

      await prisma.withTenantContext(tenantId, async (tx) => {
        const warehouse = await tx.warehouse.create({
          data: { tenantId, name: `Con saldo ${randomUUID().slice(0, 8)}` },
        });
        const lot = await tx.productLot.create({
          data: { tenantId, productId: id, lotCode: "st30" },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId: warehouse.id, quantity: 3 },
        });
      });

      const conSaldo = await request(app.getHttpServer())
        .get(`/products/${id}`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect((conSaldo.body as { hasLotStock: boolean }).hasLotStock).toBe(true);
    });
  });
});
