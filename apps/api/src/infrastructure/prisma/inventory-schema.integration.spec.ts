import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F3-DB-01: el libro mayor de
 * movimientos de stock.
 *
 * `stock_movements` es la primera tabla APPEND-ONLY con reglas de negocio en
 * el propio schema. Acá se prueban las invariantes que Prisma no expresa —
 * CHECKs, IDENTITY y la dirección de los borrados — porque son las que
 * definen qué es imposible de corromper aunque el service de F3-CORE tenga un
 * bug. El guard con mensaje claro vive en el service; esto es la red.
 */
describe("Fase 3 — invariantes de schema del inventario", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let userId: string;
  let productId: string;
  let presentationId: string;
  let warehouseId: string;
  let otherWarehouseId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant inventario ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email: `movimientos-${stamp}@example.com`,
          firstName: "Quien",
          lastNamePaternal: "Movió",
        },
      });
      const product = await tx.product.create({
        data: { tenantId, sku: `MOV-${stamp}`, name: "Producto con movimientos" },
      });
      const presentation = await tx.productPresentation.create({
        data: {
          tenantId,
          productId: product.id,
          name: "Unidad ×1",
          factor: 1,
          allowFractionalInput: false,
        },
      });
      const [warehouse, other] = await Promise.all([
        tx.warehouse.create({ data: { tenantId, name: `Central ${stamp}` } }),
        tx.warehouse.create({ data: { tenantId, name: `Sucursal ${stamp}` } }),
      ]);

      userId = user.id;
      productId = product.id;
      presentationId = presentation.id;
      warehouseId = warehouse.id;
      otherWarehouseId = other.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  /** Un movimiento válido mínimo; cada test rompe UNA cosa sobre esta base. */
  function movement(overrides: Record<string, unknown> = {}) {
    return {
      tenantId,
      batchId: randomUUID(),
      productId,
      warehouseId,
      direction: "entry" as const,
      reasonCode: "invoice" as const,
      quantity: 5,
      createdBy: userId,
      ...overrides,
    };
  }

  function create(overrides: Record<string, unknown> = {}) {
    return prisma.withTenantContext(tenantId, (tx) =>
      // biome-ignore lint/suspicious/noExplicitAny: los overrides prueban combinaciones que el tipo prohíbe
      tx.stockMovement.create({ data: movement(overrides) as any }),
    );
  }

  describe("stock_movements (F3-DB-01)", () => {
    describe("cantidades e importes", () => {
      it("rechaza `quantity = 0`: un movimiento que no mueve nada no es un movimiento", async () => {
        await expect(create({ quantity: 0 })).rejects.toThrow();
      });

      it("rechaza `quantity` negativa: el signo lo pone `direction`, nunca la cantidad", async () => {
        await expect(create({ quantity: -5 })).rejects.toThrow();
      });

      it("rechaza `unit_cost` negativo, pero lo acepta nulo (solo `invoice` lo exige)", async () => {
        await expect(create({ unitCost: -1 })).rejects.toThrow();
        await expect(create({ unitCost: null, reasonCode: "adjustment" })).resolves.toBeDefined();
      });
    });

    describe("coherencia dirección × motivo", () => {
      it.each([
        ["entry", "loss"],
        ["entry", "consumption"],
        ["entry", "expired"],
        ["entry", "sale"],
        ["exit", "invoice"],
        ["exit", "customer_return"],
        ["exit", "sale_return"],
      ])("rechaza la combinación imposible %s + %s", async (direction, reasonCode) => {
        await expect(create({ direction, reasonCode })).rejects.toThrow();
      });

      it.each([
        ["entry", "invoice"],
        ["entry", "adjustment"],
        ["entry", "customer_return"],
        ["entry", "sale_return"],
        ["entry", "physical_count"],
        ["exit", "adjustment"],
        ["exit", "sale"],
        ["exit", "loss"],
        ["exit", "consumption"],
        ["exit", "expired"],
        ["exit", "physical_count"],
      ])("acepta la combinación válida %s + %s", async (direction, reasonCode) => {
        await expect(create({ direction, reasonCode })).resolves.toBeDefined();
      });
    });

    describe("traspasos: el motivo y el almacén enlazado van juntos o no van", () => {
      it("rechaza `transfer` sin `linked_warehouse_id`: un traspaso sin contraparte no existe", async () => {
        await expect(create({ reasonCode: "transfer" })).rejects.toThrow();
      });

      it("rechaza `linked_warehouse_id` en un motivo que no es traspaso", async () => {
        await expect(
          create({ reasonCode: "adjustment", linkedWarehouseId: otherWarehouseId }),
        ).rejects.toThrow();
      });

      it("rechaza que el almacén enlazado sea el mismo que el del movimiento", async () => {
        await expect(
          create({ reasonCode: "transfer", linkedWarehouseId: warehouseId }),
        ).rejects.toThrow();
      });

      it("acepta el traspaso bien formado: motivo `transfer` y otro almacén", async () => {
        await expect(
          create({ reasonCode: "transfer", linkedWarehouseId: otherWarehouseId }),
        ).resolves.toBeDefined();
      });
    });

    describe("append-only y trazabilidad", () => {
      it("no tiene `updated_at`: una fila del libro mayor se escribe una sola vez", async () => {
        const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'stock_movements'`;

        expect(columns.map((c) => c.column_name)).not.toContain("updated_at");
      });

      /**
       * EL test de `seq`. `now()` en Postgres es el instante en que ARRANCÓ la
       * transacción, así que las N líneas de una misma factura comparten
       * `created_at` al microsegundo. Sin `seq`, ordenar el kardex por
       * `created_at` deja el desempate al azar y los saldos intermedios que
       * calcula la window function de F3-KARDEX-01 salen FALSOS.
       */
      it("`seq` desempata dos movimientos que comparten `created_at` dentro de la misma transacción", async () => {
        const batchId = randomUUID();

        const [first, second] = await prisma.withTenantContext(tenantId, async (tx) => {
          const a = await tx.stockMovement.create({ data: movement({ batchId }) });
          const b = await tx.stockMovement.create({ data: movement({ batchId }) });
          return [a, b];
        });

        expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
        expect(second.seq).toBeGreaterThan(first.seq);
      });

      it("`seq` es de la base: un INSERT no puede elegir el suyo (GENERATED ALWAYS)", async () => {
        await expect(
          prisma.withTenantContext(
            tenantId,
            (tx) => tx.$executeRaw`
            INSERT INTO stock_movements
              (seq, tenant_id, batch_id, product_id, warehouse_id, direction, reason_code, quantity, created_by)
            VALUES
              (1, ${tenantId}::uuid, ${randomUUID()}::uuid, ${productId}::uuid, ${warehouseId}::uuid,
               'entry', 'invoice', 5, ${userId}::uuid)`,
          ),
        ).rejects.toThrow();
      });
    });

    describe("borrados: un producto con historia no se borra", () => {
      it("FK RESTRICT sobre `product_id`: borrar el producto falla si tiene movimientos", async () => {
        await create();

        await expect(
          prisma.withTenantContext(tenantId, (tx) =>
            tx.product.delete({ where: { id: productId } }),
          ),
        ).rejects.toThrow();
      });

      it("FK RESTRICT sobre `presentation_id`: borrar la presentación usada falla", async () => {
        await create({ presentationId });

        await expect(
          prisma.withTenantContext(tenantId, (tx) =>
            tx.productPresentation.delete({ where: { id: presentationId } }),
          ),
        ).rejects.toThrow();
      });
    });

    describe("índices que sostienen las consultas de la fase", () => {
      it("están los cinco índices del kardex, el almacén, el lote y el traspaso", async () => {
        const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'stock_movements'`;
        const names = indexes.map((i) => i.indexname);

        expect(names).toEqual(
          expect.arrayContaining([
            "stock_movements_tenant_id_product_id_created_at_seq_idx",
            "stock_movements_tenant_id_warehouse_id_created_at_idx",
            "stock_movements_tenant_id_batch_id_idx",
            "stock_movements_presentation_id_idx",
            "stock_movements_transfer_id_idx",
          ]),
        );
      });

      it("`seq` es único: es la clave de desempate, no puede repetirse", async () => {
        const [unique] = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_indexes
        WHERE tablename = 'stock_movements' AND indexdef LIKE '%UNIQUE%seq%'`;

        expect(Number(unique?.count)).toBeGreaterThan(0);
      });
    });
  });

  /**
   * F3-DB-02 — el traspaso como PROCESO. `transfers` guarda el estado del
   * viaje (in_transit → completed | canceled) y `transfer_lines` qué y cuánto
   * salió contra cuánto llegó.
   *
   * No tiene `folio` propio a propósito: el folio del traspaso es el de su
   * documento de despacho, que es una Salida con motivo traspaso (decisión del
   * 2026-08-18). Tampoco apunta a documentos — el único enlace lo lleva
   * `inventory_documents.transfer_id`, porque un documento se confirma DESPUÉS
   * de crear el traspaso y no se puede rellenar hacia atrás.
   */
  describe("transfers y transfer_lines (F3-DB-02)", () => {
    function transfer(overrides: Record<string, unknown> = {}) {
      return {
        tenantId,
        originWarehouseId: warehouseId,
        destinationWarehouseId: otherWarehouseId,
        createdBy: userId,
        ...overrides,
      };
    }

    function createTransfer(overrides: Record<string, unknown> = {}) {
      return prisma.withTenantContext(tenantId, (tx) =>
        // biome-ignore lint/suspicious/noExplicitAny: los overrides prueban combinaciones que el tipo prohíbe
        tx.transfer.create({ data: transfer(overrides) as any }),
      );
    }

    describe("el viaje: origen, destino y estado", () => {
      it("rechaza un traspaso a sí mismo: mover de A hacia A no mueve nada", async () => {
        await expect(createTransfer({ destinationWarehouseId: warehouseId })).rejects.toThrow();
      });

      it("nace `in_transit` sin que haya que decirlo", async () => {
        const created = await createTransfer();

        expect(created.status).toBe("in_transit");
        expect(created.receivedAt).toBeNull();
        expect(created.canceledAt).toBeNull();
      });

      it("rechaza `completed` sin quién ni cuándo recibió", async () => {
        await expect(
          createTransfer({ status: "completed", receivedAt: new Date() }),
        ).rejects.toThrow();
        await expect(createTransfer({ status: "completed", receivedBy: userId })).rejects.toThrow();
      });

      it("rechaza datos de recepción en un traspaso que sigue en tránsito", async () => {
        await expect(
          createTransfer({ receivedAt: new Date(), receivedBy: userId }),
        ).rejects.toThrow();
      });

      it("rechaza `canceled` sin justificación: cancelar NO devuelve el stock, hay que explicarlo", async () => {
        await expect(
          createTransfer({ status: "canceled", canceledAt: new Date() }),
        ).rejects.toThrow();
      });

      it("acepta el traspaso completado y el cancelado bien formados", async () => {
        await expect(
          createTransfer({ status: "completed", receivedAt: new Date(), receivedBy: userId }),
        ).resolves.toBeDefined();
        await expect(
          createTransfer({
            status: "canceled",
            canceledAt: new Date(),
            canceledBy: userId,
            cancelReason: "El vehículo nunca llegó",
          }),
        ).resolves.toBeDefined();
      });

      /**
       * Guardián de la decisión del 2026-08-18: si alguien vuelve a agregarle
       * folio a `transfers`, habría dos números para el mismo traspaso y el
       * del documento dejaría de ser la única verdad.
       */
      it("NO tiene columna `folio` ni punteros a documentos", async () => {
        const columns = await prisma.$queryRaw<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.columns WHERE table_name = 'transfers'`;
        const names = columns.map((c) => c.column_name);

        expect(names).not.toContain("folio");
        expect(names).not.toContain("dispatch_document_id");
        expect(names).not.toContain("receipt_document_id");
        expect(names).not.toContain("discrepancies");
      });
    });

    describe("las líneas: lo enviado contra lo recibido", () => {
      async function createLine(overrides: Record<string, unknown> = {}) {
        const created = await createTransfer();
        return prisma.withTenantContext(tenantId, (tx) =>
          tx.transferLine.create({
            data: {
              tenantId,
              transferId: created.id,
              productId,
              quantitySent: 10,
              ...overrides,
              // biome-ignore lint/suspicious/noExplicitAny: idem
            } as any,
          }),
        );
      }

      it("rechaza enviar 0 o menos: una línea que no envía nada no es una línea", async () => {
        await expect(createLine({ quantitySent: 0 })).rejects.toThrow();
        await expect(createLine({ quantitySent: -1 })).rejects.toThrow();
      });

      it("rechaza recibir MÁS de lo enviado: el excedente entra como ajuste, no acá", async () => {
        await expect(createLine({ quantitySent: 10, quantityReceived: 11 })).rejects.toThrow();
      });

      it("acepta recibir menos, o exactamente lo enviado, o nada todavía", async () => {
        await expect(createLine({ quantitySent: 10, quantityReceived: 9 })).resolves.toBeDefined();
        await expect(createLine({ quantitySent: 10, quantityReceived: 10 })).resolves.toBeDefined();
        await expect(createLine({ quantitySent: 10, quantityReceived: 0 })).resolves.toBeDefined();
        await expect(createLine({ quantitySent: 10 })).resolves.toBeDefined();
      });

      it("un producto no puede repetirse dentro del mismo traspaso", async () => {
        const created = await createTransfer();
        const line = { tenantId, transferId: created.id, productId, quantitySent: 5 };

        await prisma.withTenantContext(tenantId, (tx) => tx.transferLine.create({ data: line }));

        await expect(
          prisma.withTenantContext(tenantId, (tx) => tx.transferLine.create({ data: line })),
        ).rejects.toThrow();
      });

      it("borrar el traspaso se lleva sus líneas (CASCADE), pero el producto con líneas no se borra (RESTRICT)", async () => {
        const created = await createTransfer();
        await prisma.withTenantContext(tenantId, (tx) =>
          tx.transferLine.create({
            data: { tenantId, transferId: created.id, productId, quantitySent: 3 },
          }),
        );

        await expect(
          prisma.withTenantContext(tenantId, (tx) =>
            tx.product.delete({ where: { id: productId } }),
          ),
        ).rejects.toThrow();

        await prisma.withTenantContext(tenantId, (tx) =>
          tx.transfer.delete({ where: { id: created.id } }),
        );
        const left = await prisma.withTenantContext(tenantId, (tx) =>
          tx.transferLine.count({ where: { transferId: created.id } }),
        );

        expect(left).toBe(0);
      });
    });

    describe("índices que sostienen la vista de tránsito", () => {
      it("los parciales de origen y destino solo indexan lo que está en tránsito", async () => {
        const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
          SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'transfers'`;
        const byName = new Map(indexes.map((i) => [i.indexname, i.indexdef]));

        expect(byName.has("transfers_tenant_id_status_created_at_idx")).toBe(true);
        // Parciales a propósito: la vista de "pendientes" solo mira in_transit,
        // y un índice completo indexaría años de traspasos ya cerrados.
        for (const name of [
          "transfers_origin_warehouse_id_idx",
          "transfers_destination_warehouse_id_idx",
        ]) {
          expect(byName.get(name)).toContain("in_transit");
        }
      });
    });
  });
});
