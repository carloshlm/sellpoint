import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F9-PO-03: el modelo de Órdenes de compra.
 *
 * Lo que fija:
 *  - las CINCO tablas llevan la RLS canónica con `FORCE`;
 *  - los CHECKs: `quantity_received` nunca supera `quantity_ordered`, una
 *    orden `open` sin sellos revienta, una recepción con cantidad cero
 *    revienta, anular exige motivo;
 *  - **la excepción quirúrgica del trigger**: sobre una orden emitida, tocar
 *    `unit_cost` de una línea revienta con `42501`, pero mover
 *    `quantity_received`/`closed_short` PASA (es lo que hace la recepción);
 *  - la cabecera de una orden emitida se sigue anotando (`notes`);
 *  - las líneas de una recepción CONFIRMADA son intocables;
 *  - el hilo hacia la compra: `purchases.purchase_order_id` y
 *    `purchase_lines.purchase_order_line_id` existen y apuntan.
 */
describe("modelo de datos de Órdenes de compra (F9-PO-03)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let warehouseA: string;
  let supplierA: string;
  let productA: string;
  const stamp = Date.now();
  const HOY = new Date("2026-09-11");

  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  const folio = (prefijo: string) =>
    `${prefijo}-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;

  /** Una orden mínima del tenant A; `extra` pisa lo que el caso quiera romper. */
  const orden = (extra: Record<string, unknown> = {}) => ({
    tenantId: tenantA,
    folio: folio("OCO"),
    supplierId: supplierA,
    warehouseId: warehouseA,
    orderDate: HOY,
    createdBy: userA,
    ...extra,
  });
  const crear = (extra: Record<string, unknown> = {}) =>
    prisma.withTenantContext(tenantA, (tx) => tx.purchaseOrder.create({ data: orden(extra) }));
  const emitida = () => crear({ status: "open", issuedAt: new Date(), issuedBy: userA });
  /**
   * Una orden EMITIDA con una línea: la línea se crea en borrador y recién
   * entonces se emite — al revés, el trigger la rechaza (y eso es correcto).
   */
  const emitidaConLinea = async () => {
    const borrador = await crear();
    const suLinea = await linea(borrador.id);
    const abierta = await prisma.withTenantContext(tenantA, (tx) =>
      tx.purchaseOrder.update({
        where: { id: borrador.id },
        data: { status: "open", issuedAt: new Date(), issuedBy: userA },
      }),
    );
    return { abierta, suLinea };
  };

  const linea = (purchaseOrderId: string, extra: Record<string, unknown> = {}) =>
    prisma.withTenantContext(tenantA, (tx) =>
      tx.purchaseOrderLine.create({
        data: {
          tenantId: tenantA,
          purchaseOrderId,
          lineNo: 1,
          productId: productA,
          quantityOrdered: new Prisma.Decimal(100),
          description: "Paracetamol 500 mg",
          ...extra,
        },
      }),
    );

  const recepcion = (purchaseOrderId: string, extra: Record<string, unknown> = {}) =>
    prisma.withTenantContext(tenantA, (tx) =>
      tx.purchaseReceipt.create({
        data: {
          tenantId: tenantA,
          folio: folio("RCP"),
          purchaseOrderId,
          receivedDate: HOY,
          createdBy: userA,
          ...extra,
        },
      }),
    );

  const lineaDeRecepcion = (
    receiptId: string,
    purchaseOrderLineId: string,
    extra: Record<string, unknown> = {},
  ) =>
    prisma.withTenantContext(tenantA, (tx) =>
      tx.purchaseReceiptLine.create({
        data: {
          tenantId: tenantA,
          receiptId,
          lineNo: 1,
          purchaseOrderLineId,
          quantity: new Prisma.Decimal(60),
          ...extra,
        },
      }),
    );

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    tenantA = (await prisma.tenant.create({ data: { name: `PO A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `PO B ${stamp}` } })).id;
    for (const [tenantId, sufijo] of [
      [tenantA, "a"],
      [tenantB, "b"],
    ] as const) {
      await prisma.withTenantContext(tenantId, async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId,
            email: `po-${stamp}-${sufijo}@example.com`,
            firstName: "Ana",
            lastName: "Pérez",
          },
        });
        const warehouse = await tx.warehouse.create({
          data: { tenantId, code: "ALM-001", name: "Central" },
        });
        const supplier = await tx.supplier.create({
          data: { tenantId, name: "Distribuidora Norte" },
        });
        const product = await tx.product.create({
          data: { tenantId, sku: `P-${stamp}-${sufijo}`, name: "Paracetamol" },
        });
        await tx.purchaseOrder.create({
          data: {
            tenantId,
            folio: "OCO-000001",
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            orderDate: HOY,
            createdBy: user.id,
          },
        });
        if (tenantId === tenantA) {
          userA = user.id;
          warehouseA = warehouse.id;
          supplierA = supplier.id;
          productA = product.id;
        }
      });
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("RLS", () => {
    it("sin contexto de tenant, cero filas en las cinco tablas con el rol real de la app", async () => {
      const { abierta, suLinea } = await emitidaConLinea();
      const suRecepcion = await recepcion(abierta.id);
      await lineaDeRecepcion(suRecepcion.id, suLinea.id);
      const filas = await asAppRole((tx) =>
        Promise.all([
          tx.purchaseOrder.findMany(),
          tx.purchaseOrderLine.findMany(),
          tx.purchaseOrderTax.findMany(),
          tx.purchaseReceipt.findMany(),
          tx.purchaseReceiptLine.findMany(),
        ]),
      );
      for (const tabla of filas) {
        expect(tabla).toHaveLength(0);
      }
    });

    it("el contexto del tenant A no ve las órdenes del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.purchaseOrder.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      });
      expect(new Set(filas.map((f) => f.tenantId))).toEqual(new Set([tenantA]));
    });
  });

  describe("CHECKs de coherencia", () => {
    it("una orden nace borrador, sin sellos, en `excluded` y en ceros; la fecha esperada es libre", async () => {
      const creada = await crear({ expectedDate: new Date("2030-01-01") });
      expect(creada).toMatchObject({ status: "draft", taxMode: "excluded" });
      expect(creada.issuedAt).toBeNull();
      expect(creada.total.toString()).toBe("0");
      expect(creada.expectedDate?.toISOString().slice(0, 10)).toBe("2030-01-01");
    });

    it("`open` sin sus sellos revienta; con ellos pasa; un borrador con sellos revienta", async () => {
      await expect(crear({ status: "open" })).rejects.toThrow();
      await expect(crear({ status: "open", issuedAt: new Date() })).rejects.toThrow();
      await expect(emitida()).resolves.toMatchObject({ status: "open" });
      await expect(crear({ issuedAt: new Date(), issuedBy: userA })).rejects.toThrow();
    });

    it("`closed` conserva la emisión y exige el cierre; anular exige quién, cuándo y por qué", async () => {
      await expect(
        crear({ status: "closed", closedAt: new Date(), closedBy: userA }),
      ).rejects.toThrow();
      await expect(
        crear({
          status: "closed",
          issuedAt: new Date(),
          issuedBy: userA,
          closedAt: new Date(),
          closedBy: userA,
        }),
      ).resolves.toMatchObject({ status: "closed" });
      await expect(crear({ status: "canceled", canceledAt: new Date() })).rejects.toThrow();
      await expect(
        crear({
          status: "canceled",
          canceledAt: new Date(),
          canceledBy: userA,
          cancelReason: "el proveedor no puede surtir",
        }),
      ).resolves.toMatchObject({ status: "canceled" });
    });

    it("un estado fuera del catálogo revienta", async () => {
      await expect(crear({ status: "confirmed" })).rejects.toThrow();
    });

    it("lo recibido nunca supera lo pedido, y lo pedido es mayor que cero", async () => {
      const borrador = await crear();
      await expect(
        linea(borrador.id, { quantityReceived: new Prisma.Decimal(101) }),
      ).rejects.toThrow();
      await expect(
        linea(borrador.id, { quantityOrdered: new Prisma.Decimal(0) }),
      ).rejects.toThrow();
      await expect(
        linea(borrador.id, { quantityReceived: new Prisma.Decimal(100) }),
      ).resolves.toMatchObject({ lineNo: 1 });
    });

    it("una línea de recepción con cantidad cero revienta", async () => {
      const { abierta, suLinea } = await emitidaConLinea();
      const suRecepcion = await recepcion(abierta.id);
      await expect(
        lineaDeRecepcion(suRecepcion.id, suLinea.id, { quantity: new Prisma.Decimal(0) }),
      ).rejects.toThrow();
    });
  });

  describe("la excepción quirúrgica del trigger", () => {
    it("sobre una orden emitida, cambiar el costo de una línea revienta; mover lo recibido PASA", async () => {
      const borrador = await crear();
      const suLinea = await linea(borrador.id, { unitCost: new Prisma.Decimal(120) });
      await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchaseOrder.update({
          where: { id: borrador.id },
          data: { status: "open", issuedAt: new Date(), issuedBy: userA },
        }),
      );

      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseOrderLine.update({
            where: { id: suLinea.id },
            data: { unitCost: new Prisma.Decimal(125) },
          }),
        ),
      ).rejects.toThrow(/42501/);
      await expect(linea(borrador.id, { lineNo: 2 })).rejects.toThrow(/42501/);
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseOrderLine.delete({ where: { id: suLinea.id } }),
        ),
      ).rejects.toThrow(/42501/);

      // Lo que mueve la recepción: las DOS columnas de la excepción.
      const recibida = await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchaseOrderLine.update({
          where: { id: suLinea.id },
          data: { quantityReceived: new Prisma.Decimal(60), closedShort: true },
        }),
      );
      expect(recibida.quantityReceived.toString()).toBe("60");
      expect(recibida.closedShort).toBe(true);
      // …pero no sirven de caballo de Troya: recibido Y costo a la vez, revienta.
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseOrderLine.update({
            where: { id: suLinea.id },
            data: { quantityReceived: new Prisma.Decimal(70), unitCost: new Prisma.Decimal(1) },
          }),
        ),
      ).rejects.toThrow(/42501/);
    });

    it("los impuestos de una orden emitida heredan la inmutabilidad", async () => {
      const abierta = await emitida();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseOrderTax.create({
            data: {
              tenantId: tenantA,
              purchaseOrderId: abierta.id,
              code: "IVA",
              name: "IVA",
              rate: new Prisma.Decimal(16),
              base: new Prisma.Decimal(100),
              amount: new Prisma.Decimal(16),
            },
          }),
        ),
      ).rejects.toThrow(/42501/);
    });

    it("la CABECERA de una orden emitida se sigue anotando: notas, referencia y fecha esperada", async () => {
      const abierta = await emitida();
      const anotada = await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchaseOrder.update({
          where: { id: abierta.id },
          data: {
            notes: "confirmado por teléfono",
            supplierReference: "COT-77",
            expectedDate: new Date("2026-09-25"),
          },
        }),
      );
      expect(anotada.supplierReference).toBe("COT-77");
    });

    it("las líneas de una recepción CONFIRMADA son intocables; las de un borrador no", async () => {
      const { abierta, suLinea } = await emitidaConLinea();
      const borrador = await recepcion(abierta.id);
      const suLineaRecibida = await lineaDeRecepcion(borrador.id, suLinea.id);
      await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchaseReceipt.update({
          where: { id: borrador.id },
          data: { status: "confirmed", confirmedAt: new Date(), confirmedBy: userA },
        }),
      );
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseReceiptLine.update({
            where: { id: suLineaRecibida.id },
            data: { quantity: new Prisma.Decimal(61) },
          }),
        ),
      ).rejects.toThrow(/42501/);
      await expect(lineaDeRecepcion(borrador.id, suLinea.id, { lineNo: 2 })).rejects.toThrow(
        /42501/,
      );
    });

    it("una recepción `confirmed` sin sellos revienta; anular exige motivo", async () => {
      const abierta = await emitida();
      await expect(recepcion(abierta.id, { status: "confirmed" })).rejects.toThrow();
      await expect(
        recepcion(abierta.id, { status: "canceled", canceledAt: new Date(), canceledBy: userA }),
      ).rejects.toThrow();
    });
  });

  describe("el hilo hacia la compra", () => {
    it("una compra y sus líneas pueden apuntar a la orden y a su línea", async () => {
      const { abierta, suLinea } = await emitidaConLinea();
      const compra = await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchase.create({
          data: {
            tenantId: tenantA,
            folio: folio("COM"),
            supplierId: supplierA,
            warehouseId: warehouseA,
            purchaseDate: HOY,
            createdBy: userA,
            purchaseOrderId: abierta.id,
            lines: {
              create: {
                tenantId: tenantA,
                lineNo: 1,
                productId: productA,
                description: "Paracetamol 500 mg",
                purchaseOrderLineId: suLinea.id,
              },
            },
          },
          include: { lines: true },
        }),
      );
      expect(compra.purchaseOrderId).toBe(abierta.id);
      expect(compra.lines[0]?.purchaseOrderLineId).toBe(suLinea.id);
      // Y una recepción sabe qué compra la facturó.
      const suRecepcion = await recepcion(abierta.id, { purchaseId: compra.id });
      expect(suRecepcion.purchaseId).toBe(compra.id);
    });

    it("una compra sin orden sigue naciendo igual que hoy", async () => {
      const compra = await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchase.create({
          data: {
            tenantId: tenantA,
            folio: folio("COM"),
            supplierId: supplierA,
            warehouseId: warehouseA,
            purchaseDate: HOY,
            createdBy: userA,
          },
        }),
      );
      expect(compra.purchaseOrderId).toBeNull();
    });
  });

  it("el folio es único por negocio, y el mismo folio existe en OTRO negocio", async () => {
    await expect(crear({ folio: "OCO-000001" })).rejects.toMatchObject({ code: "P2002" });
    const enB = await prisma.withTenantContext(tenantB, (tx) =>
      tx.purchaseOrder.findFirst({ where: { folio: "OCO-000001" } }),
    );
    expect(enB).not.toBeNull();
  });
});
