import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
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
import { textoDelPdf } from "./support/pdf-text";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-PO-09/10 — LA CADENA ENTERA: orden → recepciones → compras → entradas.
 *
 * Lo que fija, y por qué importa:
 *  - la compra nace de las recepciones con sus líneas, sus lotes y el costo
 *    ACORDADO como punto de partida, y las recepciones quedan marcadas;
 *  - la factura real a otro costo se VE (`priceVariance` en el detalle y en
 *    el PDF) y la compra **se confirma igual**;
 *  - **el costo del catálogo es el de la FACTURA, nunca el acordado**: con
 *    120 acordado y 125 facturado, `product_presentations.cost` queda 125;
 *  - la segunda recepción, la segunda compra, y la orden `received`;
 *  - una recepción se factura UNA vez; anular la compra la libera;
 *  - la compra sin orden sigue naciendo como siempre.
 */
describe("La cadena orden → recepciones → compras → entradas (F9-PO-09/10)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let proveedorId: string;
  let productoId: string;
  let cajaId: string;
  let ivaId: string;

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer(token)),
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set("Authorization", bearer(token)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set("Authorization", bearer(token)).send(body),
  });

  type Orden = { id: string; folio: string; lines: { id: string }[] };
  type Compra = {
    id: string;
    folio: string;
    status: string;
    order: { id: string; folio: string } | null;
    receipts: { id: string; folio: string }[];
    quantityVariance: boolean;
    total: string;
    lines: {
      quantity: string;
      unitCost: string | null;
      lotCode: string | null;
      expiresAt: string | null;
      purchaseOrderLineId: string | null;
      orderedUnitCost: string | null;
      priceVariance: string | null;
      productId: string;
      presentationId: string | null;
    }[];
  };

  const ordenEmitida = async (cantidad = 100) => {
    const creada = (
      await api(negocio.token)
        .post("/purchase-orders", { supplierId: proveedorId, orderDate: "2026-09-10" })
        .expect(201)
    ).body as { id: string };
    await api(negocio.token)
      .put(`/purchase-orders/${creada.id}/lines`, {
        lines: [
          {
            productId: productoId,
            presentationId: cajaId,
            quantity: cantidad,
            unitCost: 120,
            taxGroupId: ivaId,
          },
        ],
      })
      .expect(200);
    return (await api(negocio.token).post(`/purchase-orders/${creada.id}/issue`).expect(200))
      .body as Orden;
  };
  const recibirYConfirmar = async (orden: Orden, quantity: number, lotCode: string) => {
    const recepcion = (
      await api(negocio.token).post(`/purchase-orders/${orden.id}/receipts`).expect(201)
    ).body as { id: string; folio: string };
    await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/lines`, {
        lines: [
          { purchaseOrderLineId: orden.lines[0]?.id, quantity, lotCode, expiresAt: "2027-12-31" },
        ],
      })
      .expect(200);
    await api(negocio.token)
      .post(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/confirm`)
      .expect(200);
    return recepcion;
  };
  const compraDe = (orden: Orden, receiptIds: string[]) =>
    api(negocio.token).post(`/purchase-orders/${orden.id}/purchases`, { receiptIds });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    negocio = await registerTenant(app, "chain");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await api(negocio.token).patch("/tenants/me", { usesPurchaseOrders: true }).expect(200);
    const semilla = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const proveedor = await tx.supplier.create({
        data: { tenantId: negocio.tenantId, name: "Distribuidora Norte" },
      });
      const producto = await tx.product.create({
        data: {
          tenantId: negocio.tenantId,
          sku: `CH-${randomUUID().slice(0, 8)}`,
          name: "Paracetamol 500 mg",
          tracksLots: true,
          location: "Pasillo 3",
        },
      });
      const caja = await tx.productPresentation.create({
        data: {
          tenantId: negocio.tenantId,
          productId: producto.id,
          name: "Caja ×12",
          factor: "12",
          allowFractionalInput: false,
        },
      });
      const grupo = await tx.taxGroup.create({
        data: { tenantId: negocio.tenantId, code: "IVA16", name: "IVA 16%", isDefault: false },
      });
      await tx.taxRate.create({
        data: {
          tenantId: negocio.tenantId,
          taxGroupId: grupo.id,
          code: "IVA",
          name: "IVA",
          rate: "16",
        },
      });
      return {
        proveedorId: proveedor.id,
        productoId: producto.id,
        cajaId: caja.id,
        ivaId: grupo.id,
      };
    });
    proveedorId = semilla.proveedorId;
    productoId = semilla.productoId;
    cajaId = semilla.cajaId;
    ivaId = semilla.ivaId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("orden de 100 a $120 → recepción de 60 → compra a $125 con variación → entrada → costo del catálogo 125 → recepción de 40 → segunda compra → orden recibida", async () => {
    const orden = await ordenEmitida(100);
    const primera = await recibirYConfirmar(orden, 60, "L-A");

    // La compra nace de lo recibido.
    const compra = (await compraDe(orden, [primera.id]).expect(201)).body as Compra;
    expect(compra).toMatchObject({ status: "draft", order: { id: orden.id, folio: orden.folio } });
    expect(compra.receipts.map((r) => r.folio)).toEqual([primera.folio]);
    expect(compra.lines).toHaveLength(1);
    expect(compra.lines[0]).toMatchObject({
      quantity: "60",
      unitCost: "120",
      orderedUnitCost: "120",
      priceVariance: "0",
      lotCode: "L-A",
      expiresAt: "2027-12-31",
      presentationId: cajaId,
      purchaseOrderLineId: orden.lines[0]?.id,
    });
    // 60 × 120 = 7,200 + IVA 16 % = 8,352 (modo excluded, el de la orden).
    expect(compra.total).toBe("8352");

    // La factura real dice $125: se teclea encima CONSERVANDO el hilo.
    const facturada = (
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 60,
              unitCost: 125,
              taxGroupId: ivaId,
              lotCode: "L-A",
              expiresAt: "2027-12-31",
              purchaseOrderLineId: orden.lines[0]?.id,
            },
          ],
        })
        .expect(200)
    ).body as Compra;
    expect(facturada.lines[0]).toMatchObject({ orderedUnitCost: "120", priceVariance: "5" });
    expect(facturada.quantityVariance).toBe(false);

    // …y se confirma IGUAL: la variación avisa, no bloquea.
    const confirmada = (
      await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200)
    ).body as Compra;
    expect(confirmada.status).toBe("confirmed");
    const pdf = await api(negocio.token).get(`/purchases/${compra.id}/document`).expect(200);
    const texto = await textoDelPdf(pdf.body as Buffer);
    expect(texto).toContain(orden.folio);
    expect(texto).toContain(primera.folio);
    expect(texto).toContain("120.00");
    expect(texto).toContain("125.00");

    // El puente y la entrada: el costo que pisa el catálogo es el de la FACTURA.
    const entrada = (
      await api(negocio.token).post(`/purchases/${compra.id}/entry-draft`).expect(201)
    ).body as { id: string };
    await api(negocio.token).post(`/inventory/documents/${entrada.id}/confirm`).expect(201);
    const presentacion = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.productPresentation.findUniqueOrThrow({ where: { id: cajaId }, select: { cost: true } }),
    );
    expect(presentacion.cost?.toString()).toBe("125");
    const stock = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.stockLot.aggregate({
        where: { lot: { lotCode: "L-A", productId: productoId } },
        _sum: { quantity: true },
      }),
    );
    // 60 cajas ×12 = 720 piezas: la cantidad viajó en la presentación, no en base.
    expect(stock._sum.quantity?.toString()).toBe("720");

    // La segunda recepción y su compra; la orden queda recibida.
    const segunda = await recibirYConfirmar(orden, 40, "L-B");
    const compra2 = (await compraDe(orden, [segunda.id]).expect(201)).body as Compra;
    expect(compra2.lines[0]).toMatchObject({ quantity: "40", lotCode: "L-B" });
    const detalle = (await api(negocio.token).get(`/purchase-orders/${orden.id}`).expect(200))
      .body as {
      status: string;
      receipts: { folio: string; purchase: { folio: string } | null }[];
      purchases: { folio: string }[];
    };
    expect(detalle.status).toBe("received");
    expect(detalle.receipts.map((r) => r.purchase?.folio)).toEqual([compra.folio, compra2.folio]);
    expect(detalle.purchases.map((c) => c.folio)).toEqual([compra.folio, compra2.folio]);

    // El listado de compras filtra por orden.
    const lista = await api(negocio.token)
      .get(`/purchases?purchaseOrderId=${orden.id}`)
      .expect(200);
    expect((lista.body as { total: number }).total).toBe(2);
  });

  it("una recepción se factura UNA vez; anular la compra la libera; sin confirmar no se factura", async () => {
    const orden = await ordenEmitida(10);
    const recepcion = await recibirYConfirmar(orden, 10, "L-C");
    const compra = (await compraDe(orden, [recepcion.id]).expect(201)).body as Compra;
    await compraDe(orden, [recepcion.id]).expect(409);

    await api(negocio.token)
      .post(`/purchases/${compra.id}/cancel`, { reason: "capturada mal" })
      .expect(200);
    const otra = (await compraDe(orden, [recepcion.id]).expect(201)).body as Compra;
    expect(otra.receipts.map((r) => r.id)).toEqual([recepcion.id]);

    // Un borrador de recepción no se factura (sobre una orden que aún espera:
    // la de arriba ya está completa y no admite otra); una de otra orden tampoco.
    const ajena = await ordenEmitida(5);
    const enBorrador = (
      await api(negocio.token).post(`/purchase-orders/${ajena.id}/receipts`).expect(201)
    ).body as { id: string };
    await compraDe(ajena, [enBorrador.id]).expect(422);
    await compraDe(ajena, [recepcion.id]).expect(422);
  });

  it("la cantidad facturada por encima de lo recibido se VE y no bloquea; la compra sin orden sigue igual", async () => {
    const orden = await ordenEmitida(10);
    const recepcion = await recibirYConfirmar(orden, 6, "L-D");
    const compra = (await compraDe(orden, [recepcion.id]).expect(201)).body as Compra;
    const inflada = (
      await api(negocio.token)
        .put(`/purchases/${compra.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 8,
              unitCost: 120,
              lotCode: "L-D",
              expiresAt: "2027-12-31",
              purchaseOrderLineId: orden.lines[0]?.id,
            },
          ],
        })
        .expect(200)
    ).body as Compra;
    expect(inflada.quantityVariance).toBe(true);
    await api(negocio.token).post(`/purchases/${compra.id}/confirm`).expect(200);

    // Una línea que apunta a la orden EQUIVOCADA rebota.
    const otra = await ordenEmitida(3);
    const suelta = (
      await api(negocio.token)
        .post(`/purchase-orders/${otra.id}/purchases`, {
          receiptIds: [(await recibirYConfirmar(otra, 3, "L-E")).id],
        })
        .expect(201)
    ).body as Compra;
    await api(negocio.token)
      .put(`/purchases/${suelta.id}/lines`, {
        lines: [{ productId: productoId, quantity: 1, purchaseOrderLineId: orden.lines[0]?.id }],
      })
      .expect(422);

    // La compra de siempre, sin orden: nace igual y sin origen.
    const clasica = (
      await api(negocio.token)
        .post("/purchases", { supplierId: proveedorId, purchaseDate: "2026-09-10" })
        .expect(201)
    ).body as Compra;
    expect(clasica).toMatchObject({ order: null, receipts: [], quantityVariance: false });
  });
});
