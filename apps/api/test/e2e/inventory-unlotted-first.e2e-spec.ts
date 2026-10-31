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
import { startTestApp } from "./support/start-test-app";

/**
 * «que salga Lo sin lote primero» (Carlos, 2026-10-31).
 *
 * Un producto que controla lotes puede tener saldo SIN lote: lo que había
 * antes de prender el control, o lo que entró sin capturarlo. Ese saldo no
 * tiene fila propia; es `stock_by_warehouse − Σ stock_lots`. FEFO lo ignoraba:
 * con 19 en el anaquel (9 sin lote y 10 en L1), vender 12 respondía «no hay
 * suficiente existencia, disponible 10».
 *
 * Ahora toda salida que reparte por FEFO —la venta, la salida de inventario,
 * el traspaso y los componentes de un compuesto— toma primero lo sin lote, y
 * después los lotes en su orden de siempre. Estas pruebas lo recorren por la
 * API pública y miran las tres huellas: el saldo por lote, el total y el
 * `lot_id` de cada movimiento.
 */
describe("Lo sin lote sale primero (Carlos, 2026-10-31)", () => {
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

  const bearer = (t: string) => `Bearer ${t}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `sinlote-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant sin lote ${randomUUID()}`,
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

    const body = login.body as { accessToken: string };
    const payload = JSON.parse(
      Buffer.from(body.accessToken.split(".")[1] as string, "base64").toString(),
    ) as { tenantId: string };
    return { token: body.accessToken, tenantId: payload.tenantId };
  }

  const EN_60_DIAS = new Date(Date.now() + 60 * 86_400_000);

  /**
   * El caso de Carlos: 19 en el almacén, 10 en el lote L1 y 9 sin lote. Con
   * `tracksLots: false` es un producto común con sus 19, para comparar.
   *
   * Se siembra con prisma DENTRO del contexto del tenant: fuera de él, RLS
   * deja las escrituras en cero filas sin avisar.
   */
  async function escenario(opciones: { tracksLots?: boolean } = {}) {
    const { token, tenantId } = await registerAndLogin();
    const tracksLots = opciones.tracksLots ?? true;
    const datos = await prisma.withTenantContext(tenantId, async (tx) => {
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      const producto = await tx.product.create({
        data: {
          tenantId,
          sku: `MIX-${randomUUID().slice(0, 8)}`,
          name: "Suero mixto",
          tracksLots,
        },
      });
      await tx.productPresentation.create({
        data: {
          tenantId,
          productId: producto.id,
          name: "Pieza",
          factor: "1",
          price: "50.00",
          isDefaultSale: true,
          allowFractionalInput: false,
        },
      });
      await tx.stockByWarehouse.create({
        data: { tenantId, productId: producto.id, warehouseId: almacen.id, quantity: 19 },
      });
      let loteId: string | null = null;
      let loteCodigo: string | null = null;
      if (tracksLots) {
        const lote = await tx.productLot.create({
          data: {
            tenantId,
            productId: producto.id,
            lotCode: `L1-${randomUUID().slice(0, 6)}`,
            expiresAt: EN_60_DIAS,
          },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lote.id, warehouseId: almacen.id, location: "", quantity: 10 },
        });
        loteId = lote.id;
        loteCodigo = lote.lotCode;
      }
      return { productoId: producto.id, almacenId: almacen.id, loteId, loteCodigo };
    });
    return { token, tenantId, ...datos };
  }

  /** El total del producto en el almacén y el saldo de cada lote suyo. */
  async function saldos(tenantId: string, productoId: string, almacenId: string) {
    return prisma.withTenantContext(tenantId, async (tx) => {
      const total = await tx.stockByWarehouse.findFirstOrThrow({
        where: { productId: productoId, warehouseId: almacenId },
        select: { quantity: true },
      });
      const lotes = await tx.stockLot.findMany({
        where: { warehouseId: almacenId, lot: { productId: productoId } },
        select: { lotId: true, quantity: true },
      });
      return {
        total: total.quantity.toString(),
        lotes: Object.fromEntries(lotes.map((l) => [l.lotId, l.quantity.toString()])),
      };
    });
  }

  /** Los movimientos en el orden en que se asentaron, como [dirección, lote, cantidad]. */
  async function movimientos(
    tenantId: string,
    where: { saleId?: string; documentId?: string; productId?: string },
  ) {
    const filas = await prisma.withTenantContext(tenantId, (tx) =>
      tx.stockMovement.findMany({
        where,
        orderBy: { seq: "asc" },
        select: { direction: true, lotId: true, quantity: true },
      }),
    );
    return filas.map((m) => [m.direction, m.lotId, m.quantity.toString()]);
  }

  const abrirTurno = (token: string) =>
    request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

  const vender = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/pos/sales").set("Authorization", bearer(token)).send(body);

  async function salida(token: string, almacenId: string, header: Record<string, unknown>) {
    const doc = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set("Authorization", bearer(token))
      .send({ type: "exit", warehouseId: almacenId })
      .expect(201);
    const id = (doc.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/inventory/documents/${id}`)
      .set("Authorization", bearer(token))
      .send(header)
      .expect(200);
    return id;
  }

  const agregarLinea = (token: string, id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/inventory/documents/${id}/lines`)
      .set("Authorization", bearer(token))
      .send(body)
      .expect(201);

  const detalle = async (token: string, id: string) => {
    const res = await request(app.getHttpServer())
      .get(`/inventory/documents/${id}`)
      .set("Authorization", bearer(token))
      .expect(200);
    return res.body as {
      rows: {
        lotPlan: { lotCode: string | null; quantity: string }[] | null;
        errors: { code: string; args?: Record<string, unknown> }[];
      }[];
    };
  };

  const confirmar = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/inventory/documents/${id}/confirm`)
      .set("Authorization", bearer(token))
      .send({});

  describe("la venta del POS", () => {
    it("vender 12 de un producto mixto saca 9 sin lote y 3 de L1", async () => {
      const { token, tenantId, productoId, almacenId, loteId } = await escenario();
      await abrirTurno(token);

      const venta = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 12 }],
      }).expect(201);

      // Lo sin lote primero: el movimiento sin `lot_id` va antes que el de L1.
      expect(await movimientos(tenantId, { saleId: (venta.body as { id: string }).id })).toEqual([
        ["exit", null, "9"],
        ["exit", loteId, "3"],
      ]);
      // El total baja 12; L1 solo los 3 que se le tomaron.
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "7",
        lotes: { [loteId as string]: "7" },
      });
    });

    it("pedir más de lo que hay (residuo + lotes) se rechaza con disponible 19", async () => {
      const { token, tenantId, productoId, almacenId, loteId } = await escenario();
      await abrirTurno(token);

      const res = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 20 }],
      }).expect(422);

      expect(res.body).toMatchObject({
        code: "inventory.insufficient_stock",
        message: expect.stringContaining("hay 19"),
      });
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "19",
        lotes: { [loteId as string]: "10" },
      });
    });

    it("con «Vender sin existencias», el faltante va sin lote y L1 nunca queda en negativo", async () => {
      const { token, tenantId, productoId, almacenId, loteId } = await escenario();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.tenant.update({ where: { id: tenantId }, data: { sellWithoutStock: true } }),
      );
      await abrirTurno(token);

      const venta = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 25 }],
      }).expect(201);

      expect(await movimientos(tenantId, { saleId: (venta.body as { id: string }).id })).toEqual([
        ["exit", null, "15"],
        ["exit", loteId, "10"],
      ]);
      // El negativo lo absorbe el saldo sin lote (19 − 25 = −6); L1 queda en 0.
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "-6",
        lotes: { [loteId as string]: "0" },
      });
    });

    it("anular la venta devuelve cada cantidad a la cubeta de donde salió", async () => {
      const { token, tenantId, productoId, almacenId, loteId } = await escenario();
      await abrirTurno(token);
      const venta = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 12 }],
      }).expect(201);
      const ventaId = (venta.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/pos/sales/${ventaId}/cancel`)
        .set("Authorization", bearer(token))
        .send({ reason: "el cliente se arrepintió" })
        .expect(200);

      // El reverso replica los movimientos: 9 vuelven sin lote y 3 a L1. Se
      // comparan ordenados: la anulación lee los movimientos sin `orderBy`.
      const ordenar = (filas: unknown[][]) =>
        [...filas].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(ordenar(await movimientos(tenantId, { saleId: ventaId }))).toEqual(
        ordenar([
          ["exit", null, "9"],
          ["exit", loteId, "3"],
          ["entry", null, "9"],
          ["entry", loteId, "3"],
        ]),
      );
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "19",
        lotes: { [loteId as string]: "10" },
      });
    });

    it("un compuesto consume primero lo sin lote de su componente", async () => {
      const { token, tenantId, productoId, almacenId, loteId } = await escenario();
      const comboId = await prisma.withTenantContext(tenantId, async (tx) => {
        const combo = await tx.product.create({
          data: {
            tenantId,
            sku: `COMBO-${randomUUID().slice(0, 8)}`,
            name: "Kit de suero",
            isComposite: true,
          },
        });
        await tx.productPresentation.create({
          data: {
            tenantId,
            productId: combo.id,
            name: "Pieza",
            factor: "1",
            price: "90.00",
            isDefaultSale: true,
            allowFractionalInput: false,
          },
        });
        await tx.productComposition.create({
          data: {
            tenantId,
            parentProductId: combo.id,
            componentProductId: productoId,
            quantity: 2,
          },
        });
        return combo.id;
      });
      await abrirTurno(token);

      // 6 kits × 2 = 12 del componente: 9 sin lote y 3 de L1.
      const venta = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: comboId, quantity: 6 }],
      }).expect(201);

      expect(await movimientos(tenantId, { saleId: (venta.body as { id: string }).id })).toEqual([
        ["exit", null, "9"],
        ["exit", loteId, "3"],
      ]);
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "7",
        lotes: { [loteId as string]: "7" },
      });
    });

    it("un producto SIN control de lotes se vende igual que siempre", async () => {
      const { token, tenantId, productoId, almacenId } = await escenario({ tracksLots: false });
      await abrirTurno(token);

      const venta = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 12 }],
      }).expect(201);

      expect(await movimientos(tenantId, { saleId: (venta.body as { id: string }).id })).toEqual([
        ["exit", null, "12"],
      ]);
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({ total: "7", lotes: {} });
    });
  });

  describe("la salida de inventario", () => {
    it("la previa muestra el mismo reparto que asienta el confirm: 9 sin lote y 3 de L1", async () => {
      const { token, tenantId, productoId, almacenId, loteId, loteCodigo } = await escenario();
      const id = await salida(token, almacenId, { reasonCode: "loss", reasonNote: "Se mojó" });
      await agregarLinea(token, id, { productId: productoId, quantity: 12 });

      const previa = await detalle(token, id);

      // `lotCode: null` es la toma SIN lote, y va primero.
      expect(previa.rows[0]?.lotPlan).toEqual([
        expect.objectContaining({ lotCode: null, quantity: "9" }),
        expect.objectContaining({ lotCode: loteCodigo, quantity: "3" }),
      ]);
      expect(previa.rows[0]?.errors).toEqual([]);

      await confirmar(token, id).expect(201);

      expect(await movimientos(tenantId, { documentId: id })).toEqual([
        ["exit", null, "9"],
        ["exit", loteId, "3"],
      ]);
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "7",
        lotes: { [loteId as string]: "7" },
      });
    });

    it("si el confirm va a rechazar, la previa marca la línea con el mismo disponible", async () => {
      const { token, tenantId, productoId, almacenId, loteId } = await escenario();
      const id = await salida(token, almacenId, { reasonCode: "loss", reasonNote: "Imposible" });
      await agregarLinea(token, id, { productId: productoId, quantity: 20 });

      const previa = await detalle(token, id);

      expect(previa.rows[0]?.errors).toEqual([
        expect.objectContaining({
          code: "inventory.insufficient_stock",
          args: expect.objectContaining({ available: "19", requested: "20" }),
        }),
      ]);

      const res = await confirmar(token, id).expect(422);
      expect(res.body).toMatchObject({
        code: "inventory.insufficient_stock",
        message: expect.stringContaining("hay 19"),
      });
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "19",
        lotes: { [loteId as string]: "10" },
      });
    });

    it("un traspaso despacha primero lo sin lote: la línea en tránsito no lleva lote", async () => {
      const { token, tenantId, productoId, almacenId, loteId } = await escenario();
      const destino = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Sucursal ${randomUUID().slice(0, 6)}` })
        .expect(201);
      const id = await salida(token, almacenId, {
        reasonCode: "transfer",
        linkedWarehouseId: (destino.body as { id: string }).id,
      });
      await agregarLinea(token, id, { productId: productoId, quantity: 12 });

      await confirmar(token, id).expect(201);

      const lineas = await prisma.withTenantContext(tenantId, (tx) =>
        tx.transferLine.findMany({
          where: { productId: productoId },
          select: { lotId: true, quantitySent: true },
        }),
      );
      expect(
        lineas
          .map((l) => [l.lotId, l.quantitySent.toString()])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual(
        [
          [null, "9"],
          [loteId, "3"],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
      expect(await saldos(tenantId, productoId, almacenId)).toEqual({
        total: "7",
        lotes: { [loteId as string]: "7" },
      });
    });
  });
});
