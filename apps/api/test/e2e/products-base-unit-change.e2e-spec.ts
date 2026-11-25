import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import type { ImportRowError } from "../../src/modules/products/import.service";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-BULK-14 y F10-BULK-15 — cambiar la unidad base de un producto.
 *
 * Con historial, la unidad no cambia por ningún camino: ni el formulario ni la
 * importación de Excel (los movimientos se escribieron EN esa unidad). Sin
 * historial sí cambia, y entonces su presentación base la acompaña: el nombre
 * por omisión pasa a ser el de la unidad nueva y «Solo enteros» se recalcula.
 */
describe("Cambiar la unidad base (F10-BULK-14)", () => {
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

  interface Presentation {
    id: string;
    name: string;
    factor: string;
    allowFractionalInput: boolean;
    price: string | null;
  }

  async function registerAndLogin() {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant unidad base ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastName: "Pérez",
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

    const token = (login.body as { accessToken: string }).accessToken;
    const tenantId = (registered.body as { tenantId: string }).tenantId;
    const auth = () => ({ Authorization: `Bearer ${token}` });

    async function crearProducto(body: Record<string, unknown>): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/products")
        .set(auth())
        .send({ name: "Queso Oaxaca", ...body })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    async function detalle(id: string) {
      const res = await request(app.getHttpServer()).get(`/products/${id}`).set(auth()).expect(200);
      const body = res.body as { baseUnit: string; presentations: Presentation[] };
      // La presentación base es la de factor 1 que nació con el producto; el
      // detalle ya las ordena por factor y por orden de alta.
      const base = body.presentations.find((p) => Number(p.factor) === 1);
      return { baseUnit: body.baseUnit, base, presentations: body.presentations };
    }

    async function nuevoAlmacen(): Promise<string> {
      const almacen = await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.create({
          data: {
            tenantId,
            code: `WH-${Math.random().toString(36).slice(2, 10)}`,
            name: `Central ${randomUUID().slice(0, 6)}`,
          },
        }),
      );
      return almacen.id;
    }

    /** Una entrada confirmada de verdad: deja movimientos y existencias. */
    async function darEntrada(productId: string, quantity: number): Promise<void> {
      const warehouseId = await nuevoAlmacen();
      const doc = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type: "entry", warehouseId })
        .expect(201);
      const id = (doc.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ reasonCode: "adjustment", reasonNote: "prueba" })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines`)
        .set(auth())
        .send({ productId, quantity })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set(auth())
        .send({})
        .expect(201);
    }

    /** Existencias SIN movimientos: aísla el candado por saldo del de historial. */
    async function ponerExistencias(productId: string, quantity: number): Promise<void> {
      const warehouseId = await nuevoAlmacen();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.create({ data: { tenantId, productId, warehouseId, quantity } }),
      );
    }

    async function hacerComponente(componentProductId: string): Promise<void> {
      const parentProductId = await crearProducto({
        sku: `KIT-${randomUUID().slice(0, 6)}`,
        name: "Kit",
        isComposite: true,
      });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.productComposition.create({
          data: { tenantId, parentProductId, componentProductId, quantity: 2 },
        }),
      );
    }

    function importar(content: string, opciones: Record<string, unknown> = {}) {
      return request(app.getHttpServer())
        .post("/products/import")
        .set(auth())
        .send({ content, ...opciones });
    }

    return {
      tenantId,
      auth,
      crearProducto,
      detalle,
      nuevoAlmacen,
      darEntrada,
      ponerExistencias,
      hacerComponente,
      importar,
    };
  }

  const sku = (prefijo: string) => `${prefijo}-${randomUUID().slice(0, 6).toUpperCase()}`;

  describe("F10-BULK-14 — la presentación base acompaña a la unidad", () => {
    it("pasar de pieza a kilogramo renombra «Pieza» y deja escribir decimales", async () => {
      const { auth, crearProducto, detalle } = await registerAndLogin();
      const id = await crearProducto({ sku: sku("QSO"), baseUnit: "unit", price: 185 });

      const antes = await detalle(id);
      expect(antes.base).toMatchObject({ name: "Pieza", allowFractionalInput: false });

      await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set(auth())
        .send({ baseUnit: "kg" })
        .expect(200);

      const despues = await detalle(id);
      expect(despues.baseUnit).toBe("kg");
      expect(despues.base).toMatchObject({
        id: antes.base?.id,
        name: "Kilogramo",
        allowFractionalInput: true,
        // El precio no se toca: cambia la unidad, no lo que cuesta.
        price: "185",
      });
    });

    it("de vuelta a pieza, «Solo enteros» se enciende otra vez", async () => {
      const { auth, crearProducto, detalle } = await registerAndLogin();
      const id = await crearProducto({ sku: sku("BOL"), baseUnit: "kg" });

      await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set(auth())
        .send({ baseUnit: "unit" })
        .expect(200);

      expect((await detalle(id)).base).toMatchObject({
        name: "Pieza",
        allowFractionalInput: false,
      });
    });

    it("un nombre que el negocio ya personalizó no se pisa", async () => {
      const { auth, crearProducto, detalle } = await registerAndLogin();
      const id = await crearProducto({ sku: sku("PER"), baseUnit: "unit" });
      const baseId = (await detalle(id)).base?.id;
      await request(app.getHttpServer())
        .patch(`/products/${id}/presentations/${baseId}`)
        .set(auth())
        .send({ name: "Suelto" })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set(auth())
        .send({ baseUnit: "kg" })
        .expect(200);

      // El nombre se queda; «Solo enteros» sí sigue a la unidad.
      expect((await detalle(id)).base).toMatchObject({
        name: "Suelto",
        allowFractionalInput: true,
      });
    });

    it("guardar sin cambiar la unidad no toca la presentación base", async () => {
      const { auth, crearProducto, detalle } = await registerAndLogin();
      const id = await crearProducto({ sku: sku("IGU"), baseUnit: "unit", price: 10 });
      const baseId = (await detalle(id)).base?.id;
      // El Admin puede encender los decimales a mano en una pieza (F2-PRESENT).
      await request(app.getHttpServer())
        .patch(`/products/${id}/presentations/${baseId}`)
        .set(auth())
        .send({ allowFractionalInput: true })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set(auth())
        .send({ baseUnit: "unit", price: 12 })
        .expect(200);

      expect((await detalle(id)).base).toMatchObject({
        name: "Pieza",
        allowFractionalInput: true,
        price: "12",
      });
    });

    it("con un producto que es componente de otro, el formulario sigue diciendo que no", async () => {
      const { auth, crearProducto, hacerComponente, detalle } = await registerAndLogin();
      const id = await crearProducto({ sku: sku("CMP"), baseUnit: "unit" });
      await hacerComponente(id);

      const res = await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set(auth())
        .send({ baseUnit: "kg" })
        .expect(409);

      expect((res.body as { code: string }).code).toBe("products.base_unit_locked_by_composition");
      expect((await detalle(id)).base).toMatchObject({ name: "Pieza" });
    });

    it("con existencias, el formulario sigue diciendo que no", async () => {
      const { auth, crearProducto, ponerExistencias } = await registerAndLogin();
      const id = await crearProducto({ sku: sku("EXI"), baseUnit: "unit" });
      await ponerExistencias(id, 3);

      const res = await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set(auth())
        .send({ baseUnit: "kg" })
        .expect(409);

      expect((res.body as { code: string }).code).toBe("products.base_unit_locked_by_stock");
    });
  });
});
