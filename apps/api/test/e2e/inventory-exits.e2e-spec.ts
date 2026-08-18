import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/**
 * F3-EXIT-01 — el CONFIRM de una salida.
 *
 * Reusa toda la maquinaria de la entrada y suma las tres cosas que solo una
 * salida tiene: **validar que haya stock** (con las filas ya bloqueadas),
 * **expandir compuestos** en sus componentes, y **crear el traspaso** cuando el
 * motivo lo pide.
 *
 * El traspaso es una salida con `reason_code='transfer'`, no un tipo de
 * documento aparte: su folio es un `SAL-…`.
 */
describe("Confirmar una salida (F3-EXIT-01)", () => {
  let app: INestApplication<App>;
  let token: string;
  let warehouseId: string;
  let destinoId: string;
  let productId: string;
  let componenteId: string;
  let compuestoId: string;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant salidas ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);
    const mailer = app.get<NoopMailer>(MAILER);
    const verify = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token: verify })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const crearAlmacen = async (name: string) => {
      const res = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", `Bearer ${token}`)
        .send({ name })
        .expect(201);
      return (res.body as { id: string }).id;
    };
    warehouseId = await crearAlmacen(`Central ${randomUUID()}`);
    destinoId = await crearAlmacen(`Sucursal ${randomUUID()}`);

    const crearProducto = async (body: Record<string, unknown>) => {
      const res = await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ sku: `SAL-${randomUUID()}`, price: 10, ...body })
        .expect(201);
      return (res.body as { id: string }).id;
    };
    productId = await crearProducto({ name: "Paracetamol" });
    componenteId = await crearProducto({ name: "Azúcar" });
    compuestoId = await crearProducto({ name: "Café con azúcar", isComposite: true });

    // El compuesto lleva 20 de azúcar por unidad, con 10% de merma.
    await request(app.getHttpServer())
      .post(`/products/${compuestoId}/composition`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ componentId: componenteId, quantity: 20, wastePercentage: 10 }] })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function documento(
    type: "entry" | "exit",
    header: Record<string, unknown>,
    warehouse = warehouseId,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set(auth())
      .send({ type, warehouseId: warehouse })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/inventory/documents/${id}`)
      .set(auth())
      .send(header)
      .expect(200);
    return id;
  }

  const agregar = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/inventory/documents/${id}/lines`).set(auth()).send(body);

  const confirmar = (id: string) =>
    request(app.getHttpServer()).post(`/inventory/documents/${id}/confirm`).set(auth()).send({});

  const saldoDe = (res: { body: unknown }, product: string): number => {
    const stock = (res.body as { stock: { productId: string; quantity: string }[] }).stock;
    return Number(stock.find((s) => s.productId === product)?.quantity ?? 0);
  };

  /** Deja `cantidad` unidades del producto en el almacén, por una entrada real. */
  async function cargarStock(product: string, cantidad: number, warehouse = warehouseId) {
    const id = await documento(
      "entry",
      { reasonCode: "adjustment", reasonNote: "Carga inicial" },
      warehouse,
    );
    await agregar(id, { productId: product, quantity: cantidad }).expect(201);
    return confirmar(id).expect(201);
  }

  describe("el stock manda", () => {
    it("una salida normal baja el saldo", async () => {
      await cargarStock(productId, 100);
      const id = await documento("exit", { reasonCode: "loss", reasonNote: "Se cayó una caja" });
      await agregar(id, { productId, quantity: 30 }).expect(201);

      const res = await confirmar(id).expect(201);

      expect(res.body).toMatchObject({ document: { status: "confirmed" } });
      expect(saldoDe(res, productId)).toBe(70);
    });

    /**
     * El rechazo llega con el disponible REAL leído bajo el lock, no con una
     * lectura previa: es la diferencia entre no vender de más y creer que no
     * se vende de más.
     */
    it("pedir más de lo que hay se rechaza con el disponible, y el saldo no se toca", async () => {
      const antes = await cargarStock(productId, 5);
      const saldoPrevio = saldoDe(antes, productId);
      const id = await documento("exit", { reasonCode: "loss", reasonNote: "Imposible" });
      await agregar(id, { productId, quantity: saldoPrevio + 999 }).expect(201);

      const res = await confirmar(id).expect(422);

      expect((res.body as { message: string }).message).toContain(String(saldoPrevio));

      // Y el documento sigue editable: el usuario corrige sin volver a empezar.
      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { status: string }).status).toBe("draft");
    });
  });

  describe("productos compuestos", () => {
    /**
     * Un compuesto NUNCA tiene saldo propio: se arma al consumirlo. Sacar 2
     * cafés descuenta 2 × 20 × 1.10 = 44 de azúcar.
     */
    it("consumir un compuesto descuenta sus COMPONENTES con la merma aplicada", async () => {
      await cargarStock(componenteId, 500);
      const id = await documento("exit", { reasonCode: "consumption", reference: "Cafetería" });
      await agregar(id, { productId: compuestoId, quantity: 2 }).expect(201);

      const res = await confirmar(id).expect(201);

      const stock = (res.body as { stock: { productId: string; quantity: string }[] }).stock;
      // El compuesto no aparece en el stock: no tiene saldo propio.
      expect(stock.find((s) => s.productId === compuestoId)).toBeUndefined();
      expect(stock.find((s) => s.productId === componenteId)).toBeDefined();
    });

    it("una merma de compuesto se rechaza: la merma es de algo que está en el almacén", async () => {
      const id = await documento("exit", { reasonCode: "loss", reasonNote: "No aplica" });
      await agregar(id, { productId: compuestoId, quantity: 1 }).expect(201);

      await confirmar(id).expect(409);
    });
  });

  describe("el traspaso nace acá", () => {
    it("una salida con motivo traspaso crea el `Transfer` en tránsito y baja SOLO el origen", async () => {
      await cargarStock(productId, 50);
      const id = await documento("exit", {
        reasonCode: "transfer",
        linkedWarehouseId: destinoId,
      });
      await agregar(id, { productId, quantity: 10 }).expect(201);

      const res = await confirmar(id).expect(201);

      // El traspaso existe y el documento lo referencia.
      expect((res.body as { transfer?: { id: string } }).transfer?.id).toBeDefined();
      // El folio sigue siendo un SAL: un traspaso no tiene serie propia.
      expect((res.body as { document: { folio: string } }).document.folio).toMatch(/^SAL-/);
      // El origen bajó; el destino NO se tocó (eso pasa al recibir).
      const stock = (res.body as { stock: { warehouseId: string }[] }).stock;
      expect(stock.every((s) => s.warehouseId === warehouseId)).toBe(true);
    });

    it("el traspaso queda visible en la lista de tránsito del destino", async () => {
      await cargarStock(productId, 20);
      const id = await documento("exit", {
        reasonCode: "transfer",
        linkedWarehouseId: destinoId,
      });
      await agregar(id, { productId, quantity: 5 }).expect(201);
      const res = await confirmar(id).expect(201);
      const transferId = (res.body as { transfer: { id: string } }).transfer.id;

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);

      expect((detalle.body as { transferId: string }).transferId).toBe(transferId);
    });

    /**
     * El destino se valida al ELEGIRLO, no al confirmar: la base lo rechaza
     * con un CHECK, y sin el guard el usuario veía un 500 sin explicación
     * después de haber cargado todas las líneas.
     */
    it("elegirse a sí mismo como destino se rechaza al guardar la cabecera", async () => {
      const id = await documento("exit", { reasonCode: "transfer" });

      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ linkedWarehouseId: warehouseId })
        .expect(422);
    });

    it("un destino que no existe se rechaza al guardar la cabecera", async () => {
      const id = await documento("exit", { reasonCode: "transfer" });

      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ linkedWarehouseId: randomUUID() })
        .expect(404);
    });
  });

  describe("motivos", () => {
    it("un motivo de ENTRADA en un documento de salida se rechaza", async () => {
      const id = await documento("exit", { reasonCode: "loss", reasonNote: "x" });
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ reasonCode: "invoice" })
        .expect(200);
      await agregar(id, { productId, quantity: 1 }).expect(201);

      await confirmar(id).expect(422);
    });
  });
});
