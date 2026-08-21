import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F3-ENTRY-01 — el CONFIRM de una entrada.
 *
 * Es donde toda la maquinaria de la fase se junta por primera vez: resolver
 * líneas, expandir compuestos, aplicar el ledger, auditar y sellar el
 * documento — todo en UNA transacción. Y es donde la validación se pone dura:
 * el borrador admitía una línea a medio llenar, un asiento no.
 */
describe("Confirmar una entrada (F3-ENTRY-01)", () => {
  let app: INestApplication<App>;
  let token: string;
  let warehouseId: string;
  let productId: string;
  let presentationId: string;
  let compuestoId: string;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);

    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant entradas ${randomUUID()}`,
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

    const warehouse = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `Central ${randomUUID()}` })
      .expect(201);
    warehouseId = (warehouse.body as { id: string }).id;

    const crearProducto = async (body: Record<string, unknown>) => {
      const res = await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ sku: `ENT-${randomUUID()}`, price: 10, ...body })
        .expect(201);
      return (res.body as { id: string }).id;
    };

    productId = await crearProducto({ name: "Paracetamol" });
    compuestoId = await crearProducto({ name: "Combo", isComposite: true });

    // Una presentación ×12 para probar la conversión a unidad base.
    const pres = await request(app.getHttpServer())
      .post(`/products/${productId}/presentations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Caja ×12", factor: 12, allowFractionalInput: false })
      .expect(201);
    presentationId = (pres.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function borrador(header: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set(auth())
      .send({ type: "entry", warehouseId })
      .expect(201);
    const id = (res.body as { id: string }).id;

    if (Object.keys(header).length > 0) {
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send(header)
        .expect(200);
    }
    return id;
  }

  const agregar = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/inventory/documents/${id}/lines`).set(auth()).send(body);

  const confirmar = (id: string) =>
    request(app.getHttpServer()).post(`/inventory/documents/${id}/confirm`).set(auth()).send({});

  /**
   * El saldo se lee del RESULTADO del confirm, que es lo que el ledger acaba
   * de escribir. `GET /products/:id` no expone stock todavía (llega con
   * F3-KARDEX-03).
   */
  const saldoDe = (res: { body: unknown }, product: string): number => {
    const stock = (res.body as { stock: { productId: string; quantity: string }[] }).stock;
    return Number(stock.find((s) => s.productId === product)?.quantity ?? 0);
  };

  describe("el camino feliz", () => {
    it("3 cajas ×12 dejan 36 unidades y el documento confirmado", async () => {
      const id = await borrador({ reasonCode: "invoice", reference: "F-88213" });
      await agregar(id, { productId, presentationId, quantity: 3, unitCost: 15.5 }).expect(201);

      const res = await confirmar(id).expect(201);

      expect(res.body).toMatchObject({ document: { status: "confirmed" } });
      expect(saldoDe(res, productId)).toBe(36);
    });

    it("el folio es el que ya tenía el borrador: confirmar NO pide uno nuevo", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Sobrante" });
      const antes = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      await agregar(id, { productId, quantity: 1 }).expect(201);

      const res = await confirmar(id).expect(201);

      expect((res.body as { document: { folio: string } }).document.folio).toBe(
        (antes.body as { folio: string }).folio,
      );
    });
  });

  describe("acá la validación se pone dura", () => {
    it("un borrador vacío no se confirma, y sigue editable", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Nada" });

      await confirmar(id).expect(422);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { status: string }).status).toBe("draft");
    });

    /**
     * Una línea sin cantidad es un estado LEGÍTIMO del borrador —quien carga
     * 80 productos agrega la fila y después escribe—, pero no de un asiento.
     * El documento tiene que quedar editable para poder corregirla.
     */
    it("una línea sin cantidad frena el confirm y deja el borrador intacto", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Falta cantidad" });
      await agregar(id, { productId }).expect(201);

      await confirmar(id).expect(422);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { status: string }).status).toBe("draft");
    });

    it("`invoice` sin costo unitario se rechaza", async () => {
      const id = await borrador({ reasonCode: "invoice", reference: "F-1" });
      await agregar(id, { productId, quantity: 2 }).expect(201);

      await confirmar(id).expect(422);
    });

    it("una presentación solo-enteros con 1.5 se rechaza nombrando la presentación", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Decimales" });
      await agregar(id, { productId, presentationId, quantity: 1.5 }).expect(201);

      const res = await confirmar(id).expect(422);

      expect((res.body as { message: string }).message).toContain("Caja ×12");
    });

    it("un compuesto no entra al almacén: se arma al venderlo", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Compuesto" });
      await agregar(id, { productId: compuestoId, quantity: 1 }).expect(201);

      await confirmar(id).expect(409);
    });

    it("un motivo que solo emite el sistema se rechaza", async () => {
      const id = await borrador();
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ reasonCode: "physical_count" })
        .expect(400);
    });
  });

  /**
   * El caso EXACTO de la ENT-000002 de producción (2026-08-19): el borrador
   * pasó por motivo Traspaso (que le puso `linkedWarehouseId`), después el
   * motivo cambió a Ajuste — y el destino quedó pegado, invisible porque su
   * selector desaparece de la pantalla. El CHECK de `stock_movements`
   * (`(reason='transfer') = (linked IS NOT NULL)`) lo rechazaba en el confirm
   * como un 500 indescifrable.
   */
  describe("cambiar el motivo limpia lo que ya no aplica", () => {
    it("salir de Traspaso suelta el almacén vinculado y el confirm pasa", async () => {
      const destino = await request(app.getHttpServer())
        .post("/warehouses")
        .set(auth())
        .send({ name: `Destino ${randomUUID()}` })
        .expect(201);

      const id = await borrador({
        reasonCode: "transfer",
        linkedWarehouseId: (destino.body as { id: string }).id,
      });
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ reasonCode: "adjustment", reasonNote: "Cambio de idea" })
        .expect(200);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { linkedWarehouseId: string | null }).linkedWarehouseId).toBeNull();

      await agregar(id, { productId, quantity: 3 }).expect(201);
      await confirmar(id).expect(201);
    });

    /** Volver a elegir Traspaso en el MISMO patch sí conserva el destino. */
    it("mandar motivo y destino juntos no se pisa", async () => {
      const destino = await request(app.getHttpServer())
        .post("/warehouses")
        .set(auth())
        .send({ name: `Destino ${randomUUID()}` })
        .expect(201);
      const destinoId = (destino.body as { id: string }).id;

      const id = await borrador({ reasonCode: "adjustment", reasonNote: "x" });
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ reasonCode: "transfer", linkedWarehouseId: destinoId })
        .expect(200);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { linkedWarehouseId: string | null }).linkedWarehouseId).toBe(
        destinoId,
      );
    });
  });

  describe("confirmar es idempotente por la vía dura", () => {
    /**
     * Dos personas dando clic en Confirmar desde dos pantallas: si las dos
     * pasaran, el saldo se sumaría dos veces. El lock lógico del `markConfirmed`
     * lo resuelve — y el saldo lo prueba.
     */
    it("confirmar dos veces da 409 la segunda y el saldo NO se duplica", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Doble clic" });
      await agregar(id, { productId, quantity: 10 }).expect(201);

      const primera = await confirmar(id).expect(201);
      await confirmar(id).expect(409);

      // El saldo que dejó la PRIMERA confirmación es el final: la segunda no
      // sumó nada. Si el lock lógico fallara, acá habría 10 de más.
      const despues = saldoDe(primera, productId);
      const segundoDoc = await borrador({ reasonCode: "adjustment", reasonNote: "Control" });
      // Entero a propósito: la línea nace con la presentación de factor 1 y un
      // producto `count` ya no acepta fracciones — el 0.0001 de antes pasaba
      // por el bypass de la unidad base que se cerró en la revisión manual.
      await agregar(segundoDoc, { productId, quantity: 1 }).expect(201);
      const control = await confirmar(segundoDoc).expect(201);
      expect(saldoDe(control, productId)).toBeCloseTo(despues + 1, 4);
    });
  });

  /**
   * Los lotes por HTTP quedan pendientes de **F3-LOTS-01**: `tracks_lots`
   * existe en la base desde F3-DB-06 pero **ningún endpoint lo setea**
   * todavía, así que un producto creado por API nunca controla lotes y estos
   * casos no se pueden ejercitar de punta a punta sin fingir el dato.
   *
   * La lógica SÍ está cubierta: `line-resolver.integration.spec.ts` prueba
   * lote obligatorio en entrada, reuso del existente, caducidad discrepante y
   * lote en producto que no los controla.
   */

  describe("permisos y aislamiento", () => {
    it("sin token no se confirma nada", async () => {
      await request(app.getHttpServer())
        .post(`/inventory/documents/${randomUUID()}/confirm`)
        .send({})
        .expect(401);
    });

    it("un documento de otro tenant no existe", async () => {
      await confirmar(randomUUID()).expect(404);
    });
  });
  /**
   * F3-DOC-07 — el PDF. Se verifica el BINARIO de verdad (que arranque con
   * `%PDF-`, que pagine, que traduzca), no un mock del renderer: lo que
   * importa es que el archivo que baja el usuario se pueda abrir.
   */
  describe("el PDF (F3-DOC-07)", () => {
    it("baja como application/pdf, con el folio de nombre, y es un PDF válido", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Para imprimir" });
      await agregar(id, { productId, quantity: 4 }).expect(201);
      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      const folio = (detalle.body as { folio: string }).folio;

      const res = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}/pdf`)
        .set(auth())
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain(`${folio}.pdf`);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    });

    /**
     * Un conteo real son cientos de líneas. Que `pdfmake` pagine solo y repita
     * el encabezado es LA razón por la que se eligió sobre `pdfkit`, así que
     * se verifica contando las páginas del binario.
     */
    it("un documento largo sale paginado", async () => {
      const id = await borrador({ reasonCode: "adjustment", reasonNote: "Largo" });
      const lines = Array.from({ length: 120 }, () => ({ productId, quantity: 1 }));
      await request(app.getHttpServer())
        .put(`/inventory/documents/${id}/lines`)
        .set(auth())
        .send({ lines })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}/pdf`)
        .set(auth())
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      const paginas = (res.body as Buffer).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
      expect(paginas.length).toBeGreaterThan(1);
    });

    it("un documento de otro tenant no tiene PDF", async () => {
      await request(app.getHttpServer())
        .get(`/inventory/documents/${randomUUID()}/pdf`)
        .set(auth())
        .expect(404);
    });
  });
});
