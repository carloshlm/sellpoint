import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { gtinCheckDigit } from "@sellpoint/shared";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-BULK (ola 2b) — `isBase` en cada presentación que reciben la caja, las
 * entradas y las compras.
 *
 * El botón de unidad («kg | g») salía en CUALQUIER presentación de factor 1.
 * El caso de Carlos: el negocio crea «Bolsa 1 Kg» con factor 1 y su propio
 * código de barras; con «g» recordado, escanear la bolsa y teclear «2»
 * guardaba 2 g en vez de 2 bolsas. El botón va solo en la presentación BASE:
 * la de factor 1 que nació con el producto (la más antigua por `createdAt` y
 * luego por `id`, el criterio de `followBaseUnitChange`). No es la
 * predeterminada de venta: esa marca se puede pasar a un empaque.
 */
describe("La presentación base viaja marcada con `isBase`", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let quesoId: string;
  let kiloId: string;
  let bolsaUnoId: string;
  let bolsaDiezId: string;
  let almacenId: string;
  let proveedorId: string;
  let codigoBolsaUno: string;

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer(token)),
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set("Authorization", bearer(token)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set("Authorization", bearer(token)).send(body),
  });

  type Flagged = { id: string; name: string; isBase: boolean };
  /** Cada presentación como `nombre → isBase`: el orden de cada pantalla no es lo que se prueba. */
  const flags = (presentations: Flagged[] | undefined) =>
    Object.fromEntries((presentations ?? []).map((p) => [p.name, p.isBase]));

  const ESPERADO = { Kilogramo: true, "Bolsa 1 Kg": false, "Bolsa 10 Kg": false };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    // El trial Plus incluye Compras y Órdenes de compra.
    negocio = await registerTenant(app, "isbase");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await api(negocio.token).patch("/tenants/me", { usesPurchaseOrders: true }).expect(200);

    // El queso nace en kilogramos: el alta crea su «Kilogramo».
    const queso = await api(negocio.token)
      .post("/products", {
        sku: `QUESO-${randomUUID().slice(0, 8)}`,
        name: "Queso Oaxaca",
        baseUnit: "kg",
        price: 185,
      })
      .expect(201);
    quesoId = (queso.body as { id: string }).id;

    // Después, el negocio da de alta sus empaques, vendibles y con precio.
    // «Bolsa 1 Kg» también vale 1 y lleva su propio código de barras.
    const cuerpo = `75${randomUUID().replace(/\D/g, "").padEnd(10, "7").slice(0, 10)}`;
    codigoBolsaUno = `${cuerpo}${gtinCheckDigit(cuerpo)}`;
    bolsaUnoId = (
      (
        await api(negocio.token)
          .post(`/products/${quesoId}/presentations`, {
            name: "Bolsa 1 Kg",
            factor: 1,
            isSellable: true,
            price: 185,
            barcode: codigoBolsaUno,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    bolsaDiezId = (
      (
        await api(negocio.token)
          .post(`/products/${quesoId}/presentations`, {
            name: "Bolsa 10 Kg",
            factor: 10,
            isSellable: true,
            price: 1700,
          })
          .expect(201)
      ).body as { id: string }
    ).id;

    const detalle = await api(negocio.token).get(`/products/${quesoId}`).expect(200);
    kiloId =
      (detalle.body as { presentations: Flagged[] }).presentations.find(
        (p) => p.name === "Kilogramo",
      )?.id ?? "";

    const semilla = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      // Con existencias: la búsqueda de la caja esconde lo que no se puede vender.
      await tx.stockByWarehouse.create({
        data: {
          tenantId: negocio.tenantId,
          productId: quesoId,
          warehouseId: almacen.id,
          quantity: 50,
        },
      });
      const proveedor = await tx.supplier.create({
        data: {
          tenantId: negocio.tenantId,
          code: `QUESERIA-${randomUUID().slice(0, 8)}`,
          name: "Quesería del Valle",
        },
      });
      return { almacenId: almacen.id, proveedorId: proveedor.id };
    });
    almacenId = semilla.almacenId;
    proveedorId = semilla.proveedorId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("el detalle del producto marca su «Kilogramo» y no la «Bolsa 1 Kg» creada después", async () => {
    const res = await api(negocio.token).get(`/products/${quesoId}`).expect(200);
    const presentations = (res.body as { presentations: Flagged[] }).presentations;

    expect(flags(presentations)).toEqual(ESPERADO);
    expect(presentations.find((p) => p.isBase)?.id).toBe(kiloId);
  });

  it("el listado de productos también la marca", async () => {
    const res = await api(negocio.token)
      .get("/products")
      .query({ query: "Queso Oaxaca" })
      .expect(200);
    const item = (res.body as { items: { id: string; presentations: Flagged[] }[] }).items.find(
      (i) => i.id === quesoId,
    );

    expect(flags(item?.presentations)).toEqual(ESPERADO);
  });

  type LookupItem = {
    id: string;
    type: string;
    matchedPresentationId: string | null;
    presentations: Flagged[];
  };
  const buscarEnCaja = async (q: string) => {
    const res = await api(negocio.token)
      .get("/pos/lookup")
      .query({ q, warehouseId: almacenId })
      .expect(200);
    return (res.body as { items: LookupItem[] }).items.find(
      (i) => i.type === "product" && i.id === quesoId,
    );
  };

  it("la búsqueda de la caja la marca", async () => {
    const item = await buscarEnCaja("Queso Oaxaca");

    expect(flags(item?.presentations)).toEqual(ESPERADO);
  });

  it("escanear la «Bolsa 1 Kg» la preselecciona, y ella no es la base", async () => {
    const item = await buscarEnCaja(codigoBolsaUno);

    expect(item?.matchedPresentationId).toBe(bolsaUnoId);
    expect(item?.presentations.find((p) => p.id === bolsaUnoId)?.isBase).toBe(false);
    expect(flags(item?.presentations)).toEqual(ESPERADO);
  });

  it("el detalle de una entrada de inventario la marca en sus productos", async () => {
    const documento = (
      await api(negocio.token)
        .post("/inventory/documents", { type: "entry", warehouseId: almacenId })
        .expect(201)
    ).body as { id: string };
    await api(negocio.token)
      .post(`/inventory/documents/${documento.id}/lines`, {
        productId: quesoId,
        presentationId: bolsaUnoId,
        quantity: 2,
      })
      .expect(201);

    const res = await api(negocio.token).get(`/inventory/documents/${documento.id}`).expect(200);
    const producto = (
      res.body as { products: { id: string; presentations: Flagged[] }[] }
    ).products.find((p) => p.id === quesoId);

    expect(flags(producto?.presentations)).toEqual(ESPERADO);
  });

  it("el detalle de una compra la marca en sus productos", async () => {
    const compra = (
      await api(negocio.token)
        .post("/purchases", { supplierId: proveedorId, purchaseDate: "2026-11-20" })
        .expect(201)
    ).body as { id: string };
    await api(negocio.token)
      .put(`/purchases/${compra.id}/lines`, {
        lines: [{ productId: quesoId, presentationId: bolsaUnoId, quantity: 2, unitCost: 180 }],
      })
      .expect(200);

    const res = await api(negocio.token).get(`/purchases/${compra.id}`).expect(200);
    const producto = (
      res.body as { products: { id: string; presentations: Flagged[] }[] }
    ).products.find((p) => p.id === quesoId);

    expect(flags(producto?.presentations)).toEqual(ESPERADO);
  });

  it("el detalle de una orden de compra la marca en sus productos (la recepción lo lee de ahí)", async () => {
    const orden = (
      await api(negocio.token)
        .post("/purchase-orders", { supplierId: proveedorId, orderDate: "2026-11-20" })
        .expect(201)
    ).body as { id: string };
    await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/lines`, {
        lines: [{ productId: quesoId, presentationId: bolsaDiezId, quantity: 1, unitCost: 1700 }],
      })
      .expect(200);

    const res = await api(negocio.token).get(`/purchase-orders/${orden.id}`).expect(200);
    const producto = (
      res.body as { products: { id: string; presentations: Flagged[] }[] }
    ).products.find((p) => p.id === quesoId);

    expect(flags(producto?.presentations)).toEqual(ESPERADO);
  });

  it("pasar la venta predeterminada a la «Bolsa 1 Kg» no le pasa la marca de base", async () => {
    await api(negocio.token)
      .patch(`/products/${quesoId}/presentations/${bolsaUnoId}`, { isDefaultSale: true })
      .expect(200);

    const res = await api(negocio.token).get(`/products/${quesoId}`).expect(200);

    expect(flags((res.body as { presentations: Flagged[] }).presentations)).toEqual(ESPERADO);
  });
});
