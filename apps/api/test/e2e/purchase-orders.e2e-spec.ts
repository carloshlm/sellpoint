import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { EntitlementsService } from "../../src/modules/billing/entitlements.service";
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
 * F9-PO-04..06 — la orden de compra de punta a punta (sin recepciones: esas
 * llegan con F9-PO-07/08).
 *
 * Lo que fija:
 *  - el ajuste del negocio se exige SOLO para crear; leer nunca se apaga;
 *  - sin el módulo Compras (un Free), 402 en todo;
 *  - el folio `OCO-` correlativo; `orderDate` de hoy para atrás y
 *    `expectedDate` libre (la única fecha-promesa);
 *  - las líneas en BLOQUE recomponen los impuestos ESTIMADOS sin acumularlos;
 *  - emitida, la cabecera solo deja lo que no mueve dinero;
 *  - emitir exige el costo acordado nombrando la línea; cerrar marca las
 *    cortas; anular con mercancía recibida es 409;
 *  - el papel: un borrador no se manda; emitida, trae folio, proveedor y pie.
 */
describe("Órdenes de compra (F9-PO)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let sinModulo: TenantFixture;
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

  const nuevaOrden = async (extra: object = {}) =>
    (
      await api(negocio.token)
        .post("/purchase-orders", { supplierId: proveedorId, orderDate: "2026-09-10", ...extra })
        .expect(201)
    ).body as { id: string; folio: string };

  /** Una orden EMITIDA con una línea de `cantidad` cajas a `unitCost`. */
  const ordenEmitida = async (cantidad = 100, unitCost = 120) => {
    const orden = await nuevaOrden();
    await api(negocio.token)
      .put(`/purchase-orders/${orden.id}/lines`, {
        lines: [
          {
            productId: productoId,
            presentationId: cajaId,
            quantity: cantidad,
            unitCost,
            taxGroupId: ivaId,
          },
        ],
      })
      .expect(200);
    await api(negocio.token).post(`/purchase-orders/${orden.id}/issue`).expect(200);
    return orden;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    negocio = await registerTenant(app, "po");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    const semilla = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const proveedor = await tx.supplier.create({
        data: { tenantId: negocio.tenantId, name: "Distribuidora Norte", taxId: "DNO900101AB1" },
      });
      const producto = await tx.product.create({
        data: {
          tenantId: negocio.tenantId,
          sku: `PO-${randomUUID().slice(0, 8)}`,
          name: "Paracetamol 500 mg",
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

    sinModulo = await registerTenant(app, "po-free");
    await prisma.withTenantContext(sinModulo.tenantId, async (tx) => {
      const free = await tx.plan.findUniqueOrThrow({ where: { code: "free" } });
      await tx.tenantSubscription.update({
        where: { tenantId: sinModulo.tenantId },
        data: { planId: free.id },
      });
    });
    await app.get(EntitlementsService).invalidate(sinModulo.tenantId);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("el ajuste y el módulo (F9-PO-04)", () => {
    it("con el ajuste apagado, crear es 409 y leer es 200: apagarlo no esconde nada", async () => {
      await api(negocio.token)
        .post("/purchase-orders", { supplierId: proveedorId, orderDate: "2026-09-10" })
        .expect(409);
      const lista = await api(negocio.token).get("/purchase-orders").expect(200);
      expect(lista.body).toMatchObject({ total: 0, summary: { count: 0, pendingCount: 0 } });
    });

    it("sin el módulo Compras, hasta leer responde 402", async () => {
      await api(sinModulo.token).get("/purchase-orders").expect(402);
    });

    it("encendido el ajuste, las órdenes nacen con folio correlativo y en borrador", async () => {
      await api(negocio.token).patch("/tenants/me", { usesPurchaseOrders: true }).expect(200);
      const primera = await nuevaOrden({ expectedDate: "2031-01-01" });
      const segunda = await nuevaOrden();
      expect(primera.folio).toBe("OCO-000001");
      expect(segunda.folio).toBe("OCO-000002");
      const detalle = await api(negocio.token).get(`/purchase-orders/${primera.id}`).expect(200);
      expect(detalle.body).toMatchObject({
        status: "draft",
        taxMode: "excluded",
        supplierName: "Distribuidora Norte",
        expectedDate: "2031-01-01",
        total: "0",
        receipts: [],
        purchases: [],
      });
    });

    it("la fecha del pedido es de hoy para atrás; la esperada es la única que puede ser mañana", async () => {
      await api(negocio.token)
        .post("/purchase-orders", { supplierId: proveedorId, orderDate: "2031-01-01" })
        .expect(422);
      const orden = await nuevaOrden();
      await api(negocio.token)
        .patch(`/purchase-orders/${orden.id}`, { expectedDate: "2031-06-30" })
        .expect(200);
      await api(negocio.token)
        .patch(`/purchase-orders/${orden.id}`, { orderDate: "2031-06-30" })
        .expect(422);
    });

    it("dos líneas suman el total esperado y dejan UNA fila de impuesto por componente", async () => {
      const orden = await nuevaOrden();
      const conLineas = await api(negocio.token)
        .put(`/purchase-orders/${orden.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 10,
              unitCost: 100,
              taxGroupId: ivaId,
            },
            { productId: productoId, quantity: 5, unitCost: 20, taxGroupId: ivaId },
          ],
        })
        .expect(200);
      // 1000 + 100 = 1100 neto; IVA 16 % = 176; total esperado 1276.
      expect(conLineas.body).toMatchObject({ subtotal: "1100", taxTotal: "176", total: "1276" });
      expect((conLineas.body as { taxes: unknown[] }).taxes).toHaveLength(1);
      expect(
        (conLineas.body as { lines: { pending: string; quantityReceived: string }[] }).lines[0],
      ).toMatchObject({
        quantityReceived: "0",
        pending: "10",
      });
      // Guardar de nuevo con una línea no acumula impuestos.
      const otraVez = await api(negocio.token)
        .put(`/purchase-orders/${orden.id}/lines`, {
          lines: [
            {
              productId: productoId,
              presentationId: cajaId,
              quantity: 10,
              unitCost: 100,
              taxGroupId: ivaId,
            },
          ],
        })
        .expect(200);
      expect(otraVez.body).toMatchObject({ total: "1160" });
      expect((otraVez.body as { taxes: unknown[] }).taxes).toHaveLength(1);
    });

    it("una línea de cero no es un pedido, y una presentación ajena rebota", async () => {
      const orden = await nuevaOrden();
      await api(negocio.token)
        .put(`/purchase-orders/${orden.id}/lines`, {
          lines: [{ productId: productoId, quantity: 0 }],
        })
        .expect(400);
      await api(negocio.token)
        .put(`/purchase-orders/${orden.id}/lines`, {
          lines: [{ productId: productoId, presentationId: randomUUID(), quantity: 1 }],
        })
        .expect(422);
    });

    it("el listado filtra por rango DATE con DATE, por pendientes, y resume el rango", async () => {
      const deEnero = await nuevaOrden({ orderDate: "2026-01-05" });
      const delDia = await api(negocio.token)
        .get("/purchase-orders?from=2026-01-05&to=2026-01-05")
        .expect(200);
      expect((delDia.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([
        deEnero.id,
      ]);
      await api(negocio.token).get("/purchase-orders?from=2026-01-06&to=2026-01-05").expect(400);
      const pendientes = await api(negocio.token)
        .get("/purchase-orders?pendingOnly=true&from=2026-01-05&to=2026-01-05")
        .expect(200);
      // Un borrador no espera mercancía todavía.
      expect((pendientes.body as { total: number }).total).toBe(0);
    });
  });

  describe("emitir, anotar, cerrar y anular (F9-PO-05)", () => {
    it("emitir exige al menos una línea y el costo acordado, nombrando la línea", async () => {
      const vacia = await nuevaOrden();
      await api(negocio.token).post(`/purchase-orders/${vacia.id}/issue`).expect(422);

      const orden = await nuevaOrden();
      await api(negocio.token)
        .put(`/purchase-orders/${orden.id}/lines`, {
          lines: [
            { productId: productoId, presentationId: cajaId, quantity: 3, unitCost: 120 },
            { productId: productoId, quantity: 2 },
          ],
        })
        .expect(200);
      const rebote = await api(negocio.token)
        .post(`/purchase-orders/${orden.id}/issue`)
        .expect(422);
      expect((rebote.body as { message: string }).message).toContain("lines.2.unitCost");
    });

    it("emitida, las líneas y el proveedor se congelan; la fecha esperada y las notas siguen vivas", async () => {
      const orden = await ordenEmitida();
      const detalle = await api(negocio.token).get(`/purchase-orders/${orden.id}`).expect(200);
      expect(detalle.body).toMatchObject({ status: "open" });
      expect((detalle.body as { issuedAt: string | null }).issuedAt).not.toBeNull();

      await api(negocio.token)
        .put(`/purchase-orders/${orden.id}/lines`, {
          lines: [{ productId: productoId, quantity: 1 }],
        })
        .expect(409);
      await api(negocio.token)
        .patch(`/purchase-orders/${orden.id}`, { supplierId: proveedorId })
        .expect(409);
      const anotada = await api(negocio.token)
        .patch(`/purchase-orders/${orden.id}`, {
          expectedDate: "2031-03-01",
          notes: "confirmado por teléfono",
          supplierReference: "COT-77",
        })
        .expect(200);
      expect(anotada.body).toMatchObject({
        expectedDate: "2031-03-01",
        supplierReference: "COT-77",
      });
    });

    it("cerrar marca las líneas con pendiente como cortas y deja la orden cerrada", async () => {
      const orden = await ordenEmitida(100);
      // Simula lo que hará la recepción: 60 de 100 (las dos columnas que el
      // trigger deja mover).
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.purchaseOrderLine.updateMany({
          where: { purchaseOrderId: orden.id },
          data: { quantityReceived: 60 },
        }),
      );
      const cerrada = await api(negocio.token)
        .post(`/purchase-orders/${orden.id}/close`)
        .expect(200);
      expect(cerrada.body).toMatchObject({ status: "closed" });
      expect(
        (cerrada.body as { lines: { closedShort: boolean; pending: string }[] }).lines[0],
      ).toMatchObject({
        closedShort: true,
        pending: "40",
      });
      // Cerrada, ya no se anota ni se vuelve a cerrar.
      await api(negocio.token)
        .patch(`/purchase-orders/${orden.id}`, { notes: "tarde" })
        .expect(409);
      await api(negocio.token).post(`/purchase-orders/${orden.id}/close`).expect(409);
    });

    it("cerrar corta UNA línea rederiva el estado: si era la última, queda recibida", async () => {
      const orden = await nuevaOrden();
      await api(negocio.token)
        .put(`/purchase-orders/${orden.id}/lines`, {
          lines: [
            { productId: productoId, presentationId: cajaId, quantity: 10, unitCost: 100 },
            { productId: productoId, quantity: 5, unitCost: 20 },
          ],
        })
        .expect(200);
      await api(negocio.token).post(`/purchase-orders/${orden.id}/issue`).expect(200);
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.purchaseOrderLine.updateMany({
          where: { purchaseOrderId: orden.id, lineNo: 1 },
          data: { quantityReceived: 10 },
        }),
      );
      const corta = await api(negocio.token)
        .post(`/purchase-orders/${orden.id}/lines/2/close-short`)
        .expect(200);
      expect(corta.body).toMatchObject({ status: "received" });
      await api(negocio.token).post(`/purchase-orders/${orden.id}/lines/9/close-short`).expect(409);
    });

    it("anular: un borrador o una emitida sin mercancía sí; con recepción confirmada, 409; dos veces, 409", async () => {
      const borrador = await nuevaOrden();
      await api(negocio.token)
        .post(`/purchase-orders/${borrador.id}/cancel`, { reason: "pedido duplicado" })
        .expect(200);
      await api(negocio.token)
        .post(`/purchase-orders/${borrador.id}/cancel`, { reason: "otra vez" })
        .expect(409);
      await api(negocio.token)
        .post(`/purchase-orders/${borrador.id}/cancel`, { reason: "x" })
        .expect(400);

      const conMercancia = await ordenEmitida();
      await prisma.withTenantContext(negocio.tenantId, async (tx) => {
        const user = await tx.user.findFirstOrThrow({ select: { id: true } });
        await tx.purchaseReceipt.create({
          data: {
            tenantId: negocio.tenantId,
            folio: "RCP-999001",
            purchaseOrderId: conMercancia.id,
            status: "confirmed",
            receivedDate: new Date("2026-09-10"),
            createdBy: user.id,
            confirmedBy: user.id,
            confirmedAt: new Date(),
          },
        });
      });
      await api(negocio.token)
        .post(`/purchase-orders/${conMercancia.id}/cancel`, { reason: "ya no la quiero" })
        .expect(409);
    });
  });

  describe("el papel de la orden (F9-PO-06)", () => {
    it("un borrador no se manda; emitida, el PDF trae el folio, el proveedor y el pie", async () => {
      const borrador = await nuevaOrden();
      await api(negocio.token).get(`/purchase-orders/${borrador.id}/document`).expect(409);

      const orden = await ordenEmitida();
      const respuesta = await api(negocio.token)
        .get(`/purchase-orders/${orden.id}/document`)
        .expect(200)
        .expect("Content-Type", /application\/pdf/);
      const texto = await textoDelPdf(respuesta.body as Buffer);
      expect(texto).toContain(orden.folio);
      expect(texto).toContain("Distribuidora Norte");
      expect(texto).toContain("ORDEN DE COMPRA");
      expect(texto).toContain(`número de orden ${orden.folio}`);
    });
  });
});
