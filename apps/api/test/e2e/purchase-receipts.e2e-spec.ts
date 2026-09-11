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
import { startTestApp } from "./support/start-test-app";

/**
 * F9-PO-08 — las recepciones parciales y la carrera del andén.
 *
 * Lo que fija:
 *  - 60 de 100 → parcialmente recibida con 40 pendientes; los otros 40 →
 *    recibida; anular la de 40 vuelve atrás;
 *  - más de lo pendiente rebota NOMBRANDO la línea, al guardar y al confirmar;
 *  - **la carrera**: dos borradores de 60 sobre 100 pendientes — el primero
 *    confirma y el segundo rebota AUNQUE se haya capturado antes, porque la
 *    validación que manda es la del `confirm`, con las líneas de la orden
 *    tomadas con `FOR UPDATE`;
 *  - las reglas de lote son las de la compra (mismo archivo);
 *  - una recepción NO mueve existencias: `stock_movements` y `stock_lots`
 *    quedan iguales antes y después.
 */
describe("Recepciones de una orden de compra (F9-PO-07/08)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let proveedorId: string;
  let productoId: string;
  let cajaId: string;
  let sinLoteId: string;

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer(token)),
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set("Authorization", bearer(token)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set("Authorization", bearer(token)).send(body),
  });

  type Orden = { id: string; folio: string; lines: { id: string; lineNo: number }[] };
  type Recepcion = {
    id: string;
    folio: string;
    lines: {
      purchaseOrderLineId: string;
      quantity: string;
      pending: string;
      expiresAt: string | null;
    }[];
  };

  /** Una orden EMITIDA de `cantidad` cajas del producto con lotes (o del que no los lleva). */
  const ordenEmitida = async (
    cantidad = 100,
    producto = productoId,
    presentacion: string | null = cajaId,
  ) => {
    const creada = (
      await api(negocio.token)
        .post("/purchase-orders", { supplierId: proveedorId, orderDate: "2026-09-10" })
        .expect(201)
    ).body as { id: string };
    await api(negocio.token)
      .put(`/purchase-orders/${creada.id}/lines`, {
        lines: [
          { productId: producto, presentationId: presentacion, quantity: cantidad, unitCost: 120 },
        ],
      })
      .expect(200);
    return (await api(negocio.token).post(`/purchase-orders/${creada.id}/issue`).expect(200))
      .body as Orden;
  };
  const nuevaRecepcion = async (ordenId: string) =>
    (await api(negocio.token).post(`/purchase-orders/${ordenId}/receipts`).expect(201))
      .body as Recepcion;
  const recibir = async (orden: Orden, quantity: number, extra: object = {}) => {
    const recepcion = await nuevaRecepcion(orden.id);
    await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/lines`, {
        lines: [{ purchaseOrderLineId: orden.lines[0]?.id, quantity, ...extra }],
      })
      .expect(200);
    return recepcion;
  };
  const confirmar = (orden: Orden, recepcion: Recepcion) =>
    api(negocio.token).post(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/confirm`);
  const estadoDe = async (orden: Orden) =>
    (await api(negocio.token).get(`/purchase-orders/${orden.id}`).expect(200)).body as {
      status: string;
      lines: { quantityReceived: string; pending: string }[];
    };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    negocio = await registerTenant(app, "rcp");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await api(negocio.token).patch("/tenants/me", { usesPurchaseOrders: true }).expect(200);
    const semilla = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const proveedor = await tx.supplier.create({
        data: { tenantId: negocio.tenantId, name: "Distribuidora Norte" },
      });
      const producto = await tx.product.create({
        data: {
          tenantId: negocio.tenantId,
          sku: `RCP-${randomUUID().slice(0, 8)}`,
          name: "Paracetamol 500 mg",
          tracksLots: true,
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
      const sinLote = await tx.product.create({
        data: {
          tenantId: negocio.tenantId,
          sku: `NL-${randomUUID().slice(0, 8)}`,
          name: "Bolsa de papel",
        },
      });
      // Un lote del HISTÓRICO, sin existencias: la caducidad es suya.
      await tx.productLot.create({
        data: {
          tenantId: negocio.tenantId,
          productId: producto.id,
          lotCode: "HIST-01",
          expiresAt: new Date("2028-05-31"),
        },
      });
      return {
        proveedorId: proveedor.id,
        productoId: producto.id,
        cajaId: caja.id,
        sinLoteId: sinLote.id,
      };
    });
    proveedorId = semilla.proveedorId;
    productoId = semilla.productoId;
    cajaId = semilla.cajaId;
    sinLoteId = semilla.sinLoteId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("nace prellenada con lo pendiente y con folio RCP-; sobre un borrador de orden no hay recepción", async () => {
    const orden = await ordenEmitida(100);
    const recepcion = await nuevaRecepcion(orden.id);
    expect(recepcion.folio).toMatch(/^RCP-\d{6}$/);
    expect(recepcion.lines).toHaveLength(1);
    expect(recepcion.lines[0]).toMatchObject({ quantity: "100", pending: "100" });

    const borrador = (
      await api(negocio.token)
        .post("/purchase-orders", { supplierId: proveedorId, orderDate: "2026-09-10" })
        .expect(201)
    ).body as { id: string };
    await api(negocio.token).post(`/purchase-orders/${borrador.id}/receipts`).expect(409);
  });

  it("60 de 100 → parcialmente recibida; los otros 40 → recibida; anular la de 40 vuelve atrás", async () => {
    const orden = await ordenEmitida(100);
    const primera = await recibir(orden, 60, { lotCode: "l-a", expiresAt: "2027-01-31" });
    const confirmada = (await confirmar(orden, primera).expect(200)).body as Recepcion & {
      status: string;
    };
    expect(confirmada.status).toBe("confirmed");
    expect(confirmada.lines[0]).toMatchObject({ quantity: "60", pending: "40" });
    expect(await estadoDe(orden)).toMatchObject({ status: "partially_received" });
    expect((await estadoDe(orden)).lines[0]).toMatchObject({
      quantityReceived: "60",
      pending: "40",
    });

    const segunda = await recibir(orden, 40, { lotCode: "L-B", expiresAt: "2027-02-28" });
    await confirmar(orden, segunda).expect(200);
    expect(await estadoDe(orden)).toMatchObject({ status: "received" });

    await api(negocio.token)
      .post(`/purchase-orders/${orden.id}/receipts/${segunda.id}/cancel`, {
        reason: "venía dañada",
      })
      .expect(200);
    expect(await estadoDe(orden)).toMatchObject({ status: "partially_received" });
    expect((await estadoDe(orden)).lines[0]).toMatchObject({ pending: "40" });
    await api(negocio.token)
      .post(`/purchase-orders/${orden.id}/receipts/${segunda.id}/cancel`, { reason: "otra vez" })
      .expect(409);
  });

  it("más de lo pendiente rebota nombrando la línea, al guardar y al confirmar", async () => {
    const orden = await ordenEmitida(100);
    await confirmar(orden, await recibir(orden, 60, { lotCode: "L-C" })).expect(200);
    const recepcion = await nuevaRecepcion(orden.id);
    const rebote = await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/lines`, {
        lines: [{ purchaseOrderLineId: orden.lines[0]?.id, quantity: 70 }],
      })
      .expect(422);
    expect((rebote.body as { message: string }).message).toContain("lines.1.quantity");
    // Exactamente el resto sí cabe.
    await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/lines`, {
        lines: [{ purchaseOrderLineId: orden.lines[0]?.id, quantity: 40 }],
      })
      .expect(200);
  });

  it("la carrera del andén: dos borradores de 60 sobre 100 — el segundo rebota aunque se capturó antes", async () => {
    const orden = await ordenEmitida(100);
    const a = await recibir(orden, 60, { lotCode: "L-D" });
    const b = await recibir(orden, 60, { lotCode: "L-E" });
    await confirmar(orden, a).expect(200);
    const rebote = await confirmar(orden, b).expect(422);
    expect((rebote.body as { message: string }).message).toContain("lines.1.quantity");
    expect((await estadoDe(orden)).lines[0]).toMatchObject({ quantityReceived: "60" });
  });

  it("las reglas de lote son las de la compra: MAYÚSCULAS, sin lote donde no se controla, y la caducidad del conocido manda", async () => {
    const orden = await ordenEmitida(10);
    const recepcion = await recibir(orden, 5, { lotCode: "hist-01" });
    const detalle = (
      await api(negocio.token)
        .get(`/purchase-orders/${orden.id}/receipts/${recepcion.id}`)
        .expect(200)
    ).body as Recepcion;
    expect(detalle.lines[0]).toMatchObject({ expiresAt: "2028-05-31" });
    await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/lines`, {
        lines: [
          {
            purchaseOrderLineId: orden.lines[0]?.id,
            quantity: 5,
            lotCode: "HIST-01",
            expiresAt: "2029-01-01",
          },
        ],
      })
      .expect(422);

    const sinLotes = await ordenEmitida(10, sinLoteId, null);
    const suRecepcion = await nuevaRecepcion(sinLotes.id);
    const rebote = await api(negocio.token)
      .put(`/purchase-orders/${sinLotes.id}/receipts/${suRecepcion.id}/lines`, {
        lines: [{ purchaseOrderLineId: sinLotes.lines[0]?.id, quantity: 5, lotCode: "ST1" }],
      })
      .expect(422);
    expect((rebote.body as { message: string }).message).toContain("lines.1.lotCode");
  });

  it("la fecha de recepción es de hoy para atrás; una línea de otra orden rebota", async () => {
    const orden = await ordenEmitida(10);
    const otra = await ordenEmitida(10);
    const recepcion = await nuevaRecepcion(orden.id);
    await api(negocio.token)
      .patch(`/purchase-orders/${orden.id}/receipts/${recepcion.id}`, {
        receivedDate: "2031-01-01",
      })
      .expect(422);
    await api(negocio.token)
      .patch(`/purchase-orders/${orden.id}/receipts/${recepcion.id}`, {
        receivedDate: "2026-09-10",
        packingSlip: "REM-889",
      })
      .expect(200);
    await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/lines`, {
        lines: [{ purchaseOrderLineId: otra.lines[0]?.id, quantity: 1 }],
      })
      .expect(422);
  });

  it("una recepción NO mueve existencias; y una facturada no se anula", async () => {
    const antes = await prisma.withTenantContext(negocio.tenantId, async (tx) => [
      await tx.stockMovement.count(),
      await tx.stockLot.count(),
    ]);
    const orden = await ordenEmitida(10);
    const recepcion = await recibir(orden, 10, { lotCode: "L-F", expiresAt: "2027-06-30" });
    await confirmar(orden, recepcion).expect(200);
    const despues = await prisma.withTenantContext(negocio.tenantId, async (tx) => [
      await tx.stockMovement.count(),
      await tx.stockLot.count(),
    ]);
    expect(despues).toEqual(antes);

    // Facturada (la compra llega en F9-PO-09; acá se ata a mano).
    await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const user = await tx.user.findFirstOrThrow({ select: { id: true } });
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      const compra = await tx.purchase.create({
        data: {
          tenantId: negocio.tenantId,
          folio: "COM-999001",
          supplierId: proveedorId,
          warehouseId: almacen.id,
          purchaseDate: new Date("2026-09-10"),
          createdBy: user.id,
          purchaseOrderId: orden.id,
        },
      });
      await tx.purchaseReceipt.update({
        where: { id: recepcion.id },
        data: { purchaseId: compra.id },
      });
    });
    await api(negocio.token)
      .post(`/purchase-orders/${orden.id}/receipts/${recepcion.id}/cancel`, {
        reason: "no debería",
      })
      .expect(409);
  });
});
