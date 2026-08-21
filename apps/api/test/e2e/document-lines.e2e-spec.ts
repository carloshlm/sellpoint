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
 * F3-DOC-04 — las líneas del borrador.
 *
 * El borrador es lo que permite cargar 80 productos, cerrar el sistema y
 * retomar por folio: cada cambio se guarda de inmediato. Por eso guarda **sin
 * validar de fondo** — una línea a medio llenar es un estado legítimo mientras
 * el documento sea borrador. La validación dura es del `confirm`.
 */
describe("Líneas del borrador (F3-DOC-04)", () => {
  let app: INestApplication<App>;
  let token: string;
  let warehouseId: string;
  let productId: string;
  let otherProductId: string;
  let presentationId: string;
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
        tenantName: `Tenant lineas ${randomUUID()}`,
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

    const producto = await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: `LIN-${randomUUID()}`, name: "Paracetamol", price: 10 })
      .expect(201);
    productId = (producto.body as { id: string }).id;

    // La presentación base la crea el alta; el detalle es quien la devuelve.
    const detalle = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    presentationId =
      (detalle.body as { presentations: { id: string }[] }).presentations[0]?.id ?? "";

    const otro = await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: `LIN2-${randomUUID()}`, name: "Ibuprofeno", price: 5 })
      .expect(201);
    otherProductId = (otro.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function nuevoBorrador(type: "entry" | "exit" = "entry"): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set(auth())
      .send({ type, warehouseId })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const agregar = (documentId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/inventory/documents/${documentId}/lines`)
      .set(auth())
      .send(body);

  describe("crear el borrador", () => {
    it("nace con folio, en borrador y vacío", async () => {
      const res = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type: "entry", warehouseId })
        .expect(201);

      expect(res.body).toMatchObject({ status: "draft", type: "entry" });
      expect((res.body as { folio: string }).folio).toMatch(/^ENT-\d{6}$/);
    });

    it("la serie avanza por tipo: la primera salida es SAL-000001", async () => {
      const res = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type: "exit", warehouseId })
        .expect(201);

      expect((res.body as { folio: string }).folio).toBe("SAL-000001");
    });

    it("un almacén que no existe se rechaza", async () => {
      await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type: "entry", warehouseId: randomUUID() })
        .expect(404);
    });
  });

  describe("agregar, editar y quitar líneas", () => {
    it("las líneas se devuelven en el orden en que se capturaron", async () => {
      const id = await nuevoBorrador();
      await agregar(id, { productId, quantity: 3 }).expect(201);
      await agregar(id, { productId: otherProductId, quantity: 5 }).expect(201);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);

      const lines = (detalle.body as { lines: { lineNo: number; productId: string }[] }).lines;
      expect(lines.map((l) => l.lineNo)).toEqual([1, 2]);
      expect(lines[0]?.productId).toBe(productId);
    });

    /**
     * El mismo producto CON LA MISMA presentación es la misma línea: sumar es
     * lo que espera quien escanea el mismo código dos veces. Con otra
     * presentación son líneas distintas, porque "2 cajas" y "3 unidades" no se
     * pueden sumar sin convertir.
     */
    /**
     * Revisión manual de Carlos (2026-08-19): una línea recién agregada nacía
     * con `presentationId: null` y el selector ofrecía "Unidad base" ADEMÁS
     * de la "Unidad" que el alta creó — dos nombres para lo mismo, y el
     * camino null esquivaba `allowFractionalInput`. La línea nace ahora con
     * la presentación de factor 1: matemáticamente neutra (cantidad × 1),
     * pero bien nombrada y con la regla de enteros puesta.
     */
    it("sin presentación explícita, la línea nace con la de factor 1", async () => {
      const id = await nuevoBorrador();

      const res = await agregar(id, { productId, quantity: 2 }).expect(201);

      expect((res.body as { presentationId: string | null }).presentationId).toBe(presentationId);
    });

    /** Y por eso escanear dos veces SIN presentación suma con la que nació. */
    it("dos agregados sin presentación caen en la misma línea", async () => {
      const id = await nuevoBorrador();
      await agregar(id, { productId, quantity: 2 }).expect(201);
      await agregar(id, { productId, presentationId, quantity: 3 }).expect(201);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      const rows = (detalle.body as { rows: { quantityInput: string }[] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.quantityInput).toBe("5");
    });

    /** `null` EXPLÍCITO sigue siendo la unidad base: el default es solo para lo no dicho. */
    it("con null explícito la línea queda en unidad base", async () => {
      const id = await nuevoBorrador();

      const res = await agregar(id, { productId, presentationId: null, quantity: 2 }).expect(201);

      expect((res.body as { presentationId: string | null }).presentationId).toBeNull();
    });

    it("el mismo producto y presentación suma en vez de duplicar", async () => {
      const id = await nuevoBorrador();
      await agregar(id, { productId, presentationId, quantity: 2 }).expect(201);
      await agregar(id, { productId, presentationId, quantity: 3 }).expect(201);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);

      const lines = (detalle.body as { lines: { quantity: string }[] }).lines;
      expect(lines).toHaveLength(1);
      expect(Number(lines[0]?.quantity)).toBe(5);
    });

    it("una línea a medio llenar se guarda: es un borrador, no un asiento", async () => {
      const id = await nuevoBorrador();

      await agregar(id, { productId }).expect(201);
    });

    it("editar y quitar una línea", async () => {
      const id = await nuevoBorrador();
      const linea = await agregar(id, { productId, quantity: 1 }).expect(201);
      const lineId = (linea.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}/lines/${lineId}`)
        .set(auth())
        .send({ quantity: 9 })
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/inventory/documents/${id}/lines/${lineId}`)
        .set(auth())
        .expect(204);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { lines: unknown[] }).lines).toHaveLength(0);
    });

    it("el reemplazo masivo pisa todo lo que había (pegado desde la tabla)", async () => {
      const id = await nuevoBorrador();
      await agregar(id, { productId, quantity: 1 }).expect(201);

      await request(app.getHttpServer())
        .put(`/inventory/documents/${id}/lines`)
        .set(auth())
        .send({ lines: [{ productId: otherProductId, quantity: 7 }] })
        .expect(200);

      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      const lines = (detalle.body as { lines: { productId: string }[] }).lines;
      expect(lines).toHaveLength(1);
      expect(lines[0]?.productId).toBe(otherProductId);
    });
  });

  describe("lo confirmado y lo anulado no se tocan", () => {
    it("agregar una línea a un documento anulado da 409", async () => {
      const id = await nuevoBorrador();
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/cancel`)
        .set(auth())
        .send({ reason: "Me equivoqué" })
        .expect(200);

      await agregar(id, { productId, quantity: 1 }).expect(409);
    });

    it("anular deja el folio: la serie no pierde números", async () => {
      const id = await nuevoBorrador();
      const antes = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);

      const anulado = await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/cancel`)
        .set(auth())
        .send({ reason: "Duplicado" })
        .expect(200);

      expect((anulado.body as { folio: string }).folio).toBe(
        (antes.body as { folio: string }).folio,
      );
      expect((anulado.body as { status: string }).status).toBe("canceled");
    });
  });

  describe("aislamiento", () => {
    it("un documento de otro tenant no existe para este", async () => {
      await request(app.getHttpServer())
        .get(`/inventory/documents/${randomUUID()}`)
        .set(auth())
        .expect(404);
    });

    it("sin token no se llega a ningún lado", async () => {
      await request(app.getHttpServer()).post("/inventory/documents").send({}).expect(401);
    });
  });
  /**
   * F3-DOC-05 — cargar el borrador desde una planilla.
   *
   * La decisión que define este endpoint: **las filas con error igual entran**
   * marcadas. El import de productos de F2 hace lo contrario, y acá no sirve:
   * el destino es un BORRADOR, que existe para corregirse en pantalla. Devolver
   * un archivo de 200 filas porque tres tienen el sku mal obliga a editar en
   * Excel y volver a subir.
   */
  describe("importar desde una planilla (F3-DOC-05)", () => {
    let sku: string;

    beforeAll(async () => {
      const detalle = await request(app.getHttpServer())
        .get(`/products/${productId}`)
        .set(auth())
        .expect(200);
      sku = (detalle.body as { sku: string }).sku;
    });

    const csv = (filas: string[][]) =>
      [
        "sku,presentacion,cantidad,costo_unitario,lote,caducidad,ubicacion",
        ...filas.map((f) => f.join(",")),
      ].join("\n");

    const importar = (documentId: string, file: string, mode: "replace" | "append" = "append") =>
      request(app.getHttpServer())
        .post(`/inventory/documents/${documentId}/lines/import`)
        .set(auth())
        .send({ file, format: "csv", mode });

    it("la plantilla trae las columnas del tipo", async () => {
      const res = await request(app.getHttpServer())
        .get("/inventory/documents/template?type=entry&format=csv")
        .set(auth())
        .expect(200);

      expect(res.text).toContain(
        "sku,presentacion,cantidad,costo_unitario,lote,caducidad,ubicacion",
      );
    });

    it("una salida no pide costo unitario: no tiene precio de compra", async () => {
      const res = await request(app.getHttpServer())
        .get("/inventory/documents/template?type=exit&format=csv")
        .set(auth())
        .expect(200);

      expect(res.text).not.toContain("costo_unitario");
    });

    it("carga las filas del archivo como líneas del borrador", async () => {
      const id = await nuevoBorrador();

      const res = await importar(id, csv([[sku, "", "5", "", "", "", ""]])).expect(200);

      expect(res.body).toMatchObject({ imported: 1, withErrors: 0 });
      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { lines: unknown[] }).lines).toHaveLength(1);
    });

    it("`replace` pisa lo que había; `append` suma", async () => {
      const id = await nuevoBorrador();
      await importar(id, csv([[sku, "", "1", "", "", "", ""]])).expect(200);
      await importar(id, csv([[sku, "", "2", "", "", "", ""]]), "append").expect(200);

      let detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { lines: unknown[] }).lines).toHaveLength(2);

      await importar(id, csv([[sku, "", "9", "", "", "", ""]]), "replace").expect(200);
      detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      expect((detalle.body as { lines: unknown[] }).lines).toHaveLength(1);
    });

    it("una fila con sku inexistente entra MARCADA y no aborta las demás", async () => {
      const id = await nuevoBorrador();

      const res = await importar(
        id,
        csv([
          [sku, "", "3", "", "", "", ""],
          ["NO-EXISTE", "", "4", "", "", "", ""],
        ]),
      ).expect(200);

      expect(res.body).toMatchObject({ imported: 1, withErrors: 1 });
      const rows = (res.body as { rows: { row: number; error: string | null }[] }).rows;
      // La fila que se reporta es la que el usuario ve en Excel: la 3, no la 1.
      expect(rows[1]).toMatchObject({ row: 3, error: "inventory.product_not_found" });
    });

    it("sobre un documento anulado se rechaza", async () => {
      const id = await nuevoBorrador();
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/cancel`)
        .set(auth())
        .send({ reason: "No va" })
        .expect(200);

      await importar(id, csv([[sku, "", "1", "", "", "", ""]])).expect(409);
    });
  });
  /**
   * F3-DOC-06 — el listado por serie y **el detalle como VISTA PREVIA**.
   *
   * No hay endpoint de previa aparte: el detalle del borrador resuelve sus
   * líneas contra el saldo del momento y devuelve qué pasaría. Que sea la
   * MISMA `resolveLines` que usa el confirm es lo que garantiza que lo que se
   * ve sea lo que se asienta.
   */
  describe("listado y vista previa (F3-DOC-06)", () => {
    const listar = (query: string) =>
      request(app.getHttpServer()).get(`/inventory/documents?${query}`).set(auth());

    it("lista por tipo, más nuevos primero", async () => {
      await nuevoBorrador("entry");
      const res = await listar("type=entry").expect(200);

      const rows = (res.body as { rows: { type: string }[] }).rows;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.type === "entry")).toBe(true);
    });

    it("la búsqueda por folio es parcial y no distingue mayúsculas", async () => {
      const id = await nuevoBorrador("entry");
      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${id}`)
        .set(auth())
        .expect(200);
      const folio = (detalle.body as { folio: string }).folio;
      const numero = folio.split("-")[1] ?? "";

      const porNumero = await listar(`type=entry&folio=${numero}`).expect(200);
      const porPrefijoMinuscula = await listar("type=entry&folio=ent").expect(200);

      expect((porNumero.body as { rows: { folio: string }[] }).rows.map((r) => r.folio)).toContain(
        folio,
      );
      expect((porPrefijoMinuscula.body as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    });

    it("por defecto NO trae los anulados; con el filtro sí", async () => {
      const id = await nuevoBorrador("entry");
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/cancel`)
        .set(auth())
        .send({ reason: "Prueba" })
        .expect(200);

      const porDefecto = await listar("type=entry").expect(200);
      const conAnulados = await listar("type=entry&status=canceled").expect(200);

      const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);
      expect(ids((porDefecto.body as { rows: unknown }).rows)).not.toContain(id);
      expect(ids((conAnulados.body as { rows: unknown }).rows)).toContain(id);
    });

    it("cada fila trae cuántas líneas tiene, sin pedir el detalle", async () => {
      const id = await nuevoBorrador("entry");
      await agregar(id, { productId, quantity: 1 }).expect(201);
      await agregar(id, { productId: otherProductId, quantity: 1 }).expect(201);

      const res = await listar("type=entry&pageSize=100").expect(200);
      const fila = (res.body as { rows: { id: string; lineCount: number }[] }).rows.find(
        (r) => r.id === id,
      );

      expect(fila?.lineCount).toBe(2);
    });

    describe("el detalle ES la vista previa", () => {
      it("muestra el stock actual y el resultante SIN tocar el saldo real", async () => {
        const id = await nuevoBorrador("entry");
        await agregar(id, { productId, quantity: 36 }).expect(201);

        const detalle = await request(app.getHttpServer())
          .get(`/inventory/documents/${id}`)
          .set(auth())
          .expect(200);

        const fila = (detalle.body as { rows: { stockBefore: string; stockAfter: string }[] })
          .rows[0];
        expect(Number(fila?.stockBefore)).toBe(0);
        expect(Number(fila?.stockAfter)).toBe(36);

        // Y el saldo REAL sigue intacto: mirar es gratis.
        const otra = await request(app.getHttpServer())
          .get(`/inventory/documents/${id}`)
          .set(auth())
          .expect(200);
        expect(
          Number((otra.body as { rows: { stockBefore: string }[] }).rows[0]?.stockBefore),
        ).toBe(0);
      });

      it("una presentación ×N convierte a unidad base en la previa", async () => {
        const id = await nuevoBorrador("entry");
        await agregar(id, { productId, presentationId, quantity: 3 }).expect(201);

        const detalle = await request(app.getHttpServer())
          .get(`/inventory/documents/${id}`)
          .set(auth())
          .expect(200);

        const fila = (detalle.body as { rows: { quantityBase: string }[] }).rows[0];
        expect(Number(fila?.quantityBase)).toBe(3);
      });

      /**
       * La previa junta TODOS los errores en vez de tirar el primero: quien
       * cargó 80 líneas necesita ver las cinco que están mal de una vez, no
       * descubrirlas de a una.
       */
      it("una línea sin cantidad aparece con su error, y el resumen lo cuenta", async () => {
        const id = await nuevoBorrador("entry");
        await agregar(id, { productId }).expect(201);
        await agregar(id, { productId: otherProductId, quantity: 5 }).expect(201);

        const detalle = await request(app.getHttpServer())
          .get(`/inventory/documents/${id}`)
          .set(auth())
          .expect(200);

        const body = detalle.body as {
          rows: { errors: { code: string }[] }[];
          summary: { errors: number; lines: number };
        };
        expect(body.summary.lines).toBe(2);
        expect(body.summary.errors).toBe(1);
        expect(body.rows[0]?.errors).toHaveLength(1);
        expect(body.rows[1]?.errors).toHaveLength(0);
      });

      it("una salida sin saldo se marca con el disponible, no revienta la previa", async () => {
        const id = await nuevoBorrador("exit");
        await agregar(id, { productId, quantity: 999 }).expect(201);

        const detalle = await request(app.getHttpServer())
          .get(`/inventory/documents/${id}`)
          .set(auth())
          .expect(200);

        const body = detalle.body as { rows: { errors: { code: string }[]; available: string }[] };
        expect(body.rows[0]?.errors[0]?.code).toBe("inventory.insufficient_stock");
        expect(Number(body.rows[0]?.available)).toBe(0);
      });
    });
  });
});
