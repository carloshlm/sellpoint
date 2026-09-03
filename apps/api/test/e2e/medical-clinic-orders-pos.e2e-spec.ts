import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, cargarStock, crearProducto, type TenantFixture } from "./support/billing-scenario";
import { adminDePlataforma, consultorio } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-CLINIC-20 — de la orden médica a la caja.
 *
 * Receta con un medicamento del stock + orden de laboratorio con dos estudios
 * → dos órdenes, dos cotizaciones, MISMO folio; la caja las encuentra por
 * folio, `for-sale` trae el producto con precio de HOY y los conceptos con el
 * precio de la orden; se cobran; los conceptos llevan su origen y el stock
 * solo se mueve por el medicamento; cancelar una cobrada es 409. Y lo que el
 * negocio no vende toma folio ORM y la caja no lo encuentra.
 */
describe("Consultorio Médico — órdenes y caja (F9-CLINIC-20)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture & { warehouseId: string };
  let productoId: string;
  let recordId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    admin = await adminDePlataforma(app, prisma, "orders-admin");
    negocio = await consultorio(app, prisma, "orders", admin);

    const producto = await crearProducto(app, negocio.token, 45);
    productoId = producto.id;
    await cargarStock(app, negocio.token, negocio.warehouseId, productoId, 10);

    const paciente = await post(negocio.token, "/medical-clinic/patients", {
      firstName: "Rosa",
      lastNamePaternal: "Luna",
    }).expect(201);
    const expediente = await post(negocio.token, "/medical-clinic/records", {
      customerId: (paciente.body as { id: string }).id,
    }).expect(201);
    recordId = (expediente.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  function post(token: string, url: string, body: object = {}) {
    return request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body);
  }
  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  const put = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).put(url).set("Authorization", bearer(token)).send(body);

  interface Orden {
    id: string;
    folio: string;
    quoteId: string | null;
    quoteFolio: string | null;
    chargeStatus: string;
    lines: { id: string; description: string; unitPrice: string }[];
  }

  it("la receta crea su cotización con el mismo folio, la caja la cobra y el stock baja", async () => {
    const receta = await post(negocio.token, `/medical-clinic/records/${recordId}/orders`, {
      kind: "prescription",
      lines: [{ productId: productoId, quantity: 2, dosage: "1 cada 8 h" }],
      indications: "Con alimentos",
      diagnosis: "Faringitis",
    }).expect(201);
    const orden = receta.body as Orden;
    expect(orden.folio).toMatch(/^COT-/);
    expect(orden.folio).toBe(orden.quoteFolio);
    expect(orden.chargeStatus).toBe("pending");

    // El médico busca medicamentos en SU stock sin pos:sell ni caja.
    const stock = await get(negocio.token, "/medical-clinic/stock-search?q=parac").expect(200);
    expect((stock.body as { items: { type: string; id: string }[] }).items).toEqual([
      expect.objectContaining({ type: "product", id: productoId }),
    ]);

    // La caja: abre turno, encuentra el folio, carga y cobra.
    await post(negocio.token, "/pos/session").expect(201);
    const lookup = await get(negocio.token, `/pos/lookup?q=${orden.folio}`).expect(200);
    expect((lookup.body as { items: { type: string }[] }).items[0]?.type).toBe("quote");
    const paraVender = await get(negocio.token, `/pos/quotes/folio/${orden.folio}/for-sale`).expect(
      200,
    );
    const lineas = (paraVender.body as { lines: { unitPrice: string; item: { type: string } }[] })
      .lines;
    expect(lineas[0]?.item.type).toBe("product");
    expect(lineas[0]?.unitPrice).toBe("45");

    const venta = await post(negocio.token, "/pos/sales", {
      paymentMethod: "cash",
      quoteId: orden.quoteId,
      lines: [{ productId: productoId, quantity: 2 }],
    }).expect(201);
    const saleId = (venta.body as { id: string }).id;
    const movimientos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.stockMovement.findMany({ where: { saleId }, select: { productId: true } }),
    );
    expect(movimientos.map((m) => m.productId)).toEqual([productoId]);

    // Cobrada: el listado lo dice, y cancelar es 409.
    const lista = await get(negocio.token, `/medical-clinic/records/${recordId}/orders`).expect(
      200,
    );
    const cobrada = (lista.body as Orden[]).find((o) => o.id === orden.id);
    expect(cobrada?.chargeStatus).toBe("charged");
    await post(negocio.token, `/medical-clinic/orders/${orden.id}/cancel`).expect(409);
  });

  it("con venta de laboratorio, los estudios se cobran como conceptos con origen; el documento sale en carta", async () => {
    await put(negocio.token, "/medical-clinic/settings", { sellsLabStudies: true }).expect(200);
    const bh = await post(negocio.token, "/medical-clinic/lab-studies", {
      code: "BH",
      name: "Biometría hemática",
      price: 180,
    }).expect(201);
    const glu = await post(negocio.token, "/medical-clinic/lab-studies", {
      code: "GLU",
      name: "Glucosa",
      price: 95,
    }).expect(201);
    const labIds = [bh.body, glu.body].map((b) => (b as { id: string }).id);

    const creada = await post(negocio.token, `/medical-clinic/records/${recordId}/orders`, {
      kind: "lab_order",
      lines: labIds.map((labStudyId) => ({ labStudyId })),
      indications: "En ayunas",
    }).expect(201);
    const orden = creada.body as Orden;
    expect(orden.folio).toBe(orden.quoteFolio);
    expect(orden.lines.map((l) => l.description)).toEqual(["Biometría hemática", "Glucosa"]);

    const paraVender = await get(negocio.token, `/pos/quotes/folio/${orden.folio}/for-sale`).expect(
      200,
    );
    const lineas = (
      paraVender.body as { lines: { unitPrice: string; item: { type: string; id: string } }[] }
    ).lines;
    expect(lineas.map((l) => l.item.type)).toEqual(["concept", "concept"]);
    expect(lineas.map((l) => l.unitPrice)).toEqual(["180", "95"]);

    const venta = await post(negocio.token, "/pos/sales", {
      paymentMethod: "card",
      quoteId: orden.quoteId,
      lines: lineas.map((l) => ({ quoteLineId: l.item.id, quantity: 1 })),
    }).expect(201);
    const items = (
      venta.body as {
        items: {
          kind: string;
          conceptDescription: string;
          sourceModule: string;
          sourceRef: string;
        }[];
      }
    ).items;
    expect(items.map((i) => i.kind)).toEqual(["concept", "concept"]);
    expect(items[0]).toMatchObject({
      conceptDescription: "Biometría hemática",
      sourceModule: "medical_clinic",
      sourceRef: orden.lines[0]?.id,
    });
    // Sin un solo movimiento de stock: los estudios no salen de ningún anaquel.
    const movimientos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.stockMovement.count({ where: { saleId: (venta.body as { id: string }).id } }),
    );
    expect(movimientos).toBe(0);

    const documento = await get(
      negocio.token,
      `/medical-clinic/orders/${orden.id}/document`,
    ).expect(200);
    expect(documento.headers["content-type"]).toContain("application/pdf");
    expect(documento.headers["content-disposition"]).toContain(`${orden.folio}.pdf`);
  });

  it("lo que el negocio no vende toma folio ORM, no crea cotización y la caja no lo encuentra", async () => {
    const rx = await post(negocio.token, "/medical-clinic/diagnostic-studies", {
      code: "RX",
      name: "Rayos X de tórax",
      price: 350,
    }).expect(201);
    const creada = await post(negocio.token, `/medical-clinic/records/${recordId}/orders`, {
      kind: "diagnostic_order",
      lines: [{ diagnosticStudyId: (rx.body as { id: string }).id }],
    }).expect(201);
    const orden = creada.body as Orden;
    expect(orden.folio).toMatch(/^ORM-/);
    expect(orden.quoteId).toBeNull();
    expect(orden.chargeStatus).toBe("not_for_sale");

    const lookup = await get(negocio.token, `/pos/lookup?q=${orden.folio}`).expect(200);
    expect((lookup.body as { items: unknown[] }).items).toHaveLength(0);

    // Cancelar solo cancela la orden; dos veces, 409.
    const cancelada = await post(negocio.token, `/medical-clinic/orders/${orden.id}/cancel`).expect(
      200,
    );
    expect((cancelada.body as { status: string }).status).toBe("canceled");
    await post(negocio.token, `/medical-clinic/orders/${orden.id}/cancel`).expect(409);
  });

  it("un expediente cerrado no emite órdenes; una orden sin líneas ni se intenta", async () => {
    await post(negocio.token, `/medical-clinic/records/${recordId}/orders`, {
      kind: "lab_order",
      lines: [],
    }).expect(400);
    await post(negocio.token, `/medical-clinic/records/${recordId}/close`).expect(200);
    await post(negocio.token, `/medical-clinic/records/${recordId}/orders`, {
      kind: "prescription",
      lines: [{ productId: productoId, quantity: 1 }],
    }).expect(409);
  });
});
