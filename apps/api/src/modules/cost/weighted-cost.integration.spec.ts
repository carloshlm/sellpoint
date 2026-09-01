import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { WeightedCostService } from "./weighted-cost.service";

/**
 * Integration (Postgres REAL) — F5-COST-01: el costo promedio ponderado.
 *
 * ── Por qué integration y no unit con mocks ─────────────────────────────
 *
 * Lo que se prueba es una consulta sobre el LIBRO MAYOR: qué movimientos
 * cuentan, cómo se cruzan con el `factor` de su presentación y cómo pondera
 * Postgres los decimales. Un mock del cliente Prisma probaría que yo escribí
 * lo que yo pensé, no que la base devuelve lo que necesito.
 *
 * ── Las tres reglas que sostiene ────────────────────────────────────────
 *
 *  1. **Solo las entradas `invoice` con costo.** Un ajuste, una devolución o
 *     un traspaso no son una COMPRA: no dicen cuánto costó la mercancía.
 *  2. **El costo se normaliza a `base_unit`.** `unit_cost` se captura al nivel
 *     de la presentación («$120 la caja»), y la cantidad se asienta en base
 *     («12 piezas»): sin dividir por el `factor`, una caja de 12 costaría lo
 *     mismo que una pieza.
 *  3. **Sin historial devuelve `null`, no cero.** Un 0 se sumaría al valor
 *     del inventario y lo haría mentir; el consumidor decide su fallback.
 */
describe("WeightedCostService (F5-COST-01)", () => {
  let prisma: PrismaService;
  let service: WeightedCostService;
  let tenantId: string;
  let userId: string;
  let warehouseId: string;
  let simpleId: string;
  let sinHistorialId: string;
  let porCajaId: string;
  let cajaPresentationId: string;
  let piezaPresentationId: string;
  let documentId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    service = new WeightedCostService(prisma);

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant cost ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email: `cost-${stamp}@example.com`,
          passwordHash: "x",
          firstName: "Ana",
          lastNamePaternal: "Pérez",
        },
      });
      userId = user.id;

      const warehouse = await tx.warehouse.create({
        data: {
          tenantId,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Central cost ${stamp}`,
        },
      });
      warehouseId = warehouse.id;

      const simple = await tx.product.create({
        data: { tenantId, sku: `CS-${stamp}`, name: "Costeado simple" },
      });
      simpleId = simple.id;

      const sinHistorial = await tx.product.create({
        data: { tenantId, sku: `CN-${stamp}`, name: "Nunca comprado" },
      });
      sinHistorialId = sinHistorial.id;

      const porCaja = await tx.product.create({
        data: { tenantId, sku: `CC-${stamp}`, name: "Comprado por caja" },
      });
      porCajaId = porCaja.id;

      // Una caja trae 12 piezas: el `factor` es lo que traduce el costo.
      const caja = await tx.productPresentation.create({
        data: {
          tenantId,
          productId: porCaja.id,
          name: "Caja",
          factor: "12",
          allowFractionalInput: false,
        },
      });
      cajaPresentationId = caja.id;

      const pieza = await tx.productPresentation.create({
        data: {
          tenantId,
          productId: porCaja.id,
          name: "Pieza",
          factor: "1",
          allowFractionalInput: false,
        },
      });
      piezaPresentationId = pieza.id;

      // Todo movimiento cuelga de un documento o de una venta: lo exige el
      // CHECK `stock_movements_document_xor_sale`. Acá alcanza uno solo —lo
      // que se prueba es el costeo, no el papeleo.
      const document = await tx.inventoryDocument.create({
        data: {
          tenantId,
          // El folio tiene largo acotado en la base: los últimos 6 del stamp
          // alcanzan para no chocar con otra corrida.
          folio: `ENT-${String(stamp).slice(-6)}`,
          type: "entry",
          status: "confirmed",
          warehouseId: warehouse.id,
          reasonCode: "invoice",
          createdBy: user.id,
          confirmedBy: user.id,
          confirmedAt: new Date(),
        },
      });
      documentId = document.id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Un asiento directo al libro mayor: acá no se prueba el ledger, se prueba el costeo. */
  async function asentar(input: {
    productId: string;
    quantity: string;
    unitCost?: string | null;
    reasonCode?: "invoice" | "adjustment" | "customer_return" | "transfer";
    direction?: "entry" | "exit";
    presentationId?: string | null;
    linkedWarehouseId?: string;
  }) {
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.stockMovement.create({
        data: {
          tenantId,
          documentId,
          productId: input.productId,
          warehouseId,
          presentationId: input.presentationId ?? null,
          direction: input.direction ?? "entry",
          reasonCode: input.reasonCode ?? "invoice",
          // El CHECK `transfer_link_check` es una EQUIVALENCIA: un traspaso
          // sin el otro almacén no se puede reconstruir, y un almacén
          // enlazado en un ajuste es basura para el kardex.
          linkedWarehouseId: input.linkedWarehouseId ?? null,
          quantity: input.quantity,
          unitCost: input.unitCost ?? null,
          createdBy: userId,
        },
      }),
    );
  }

  describe("el promedio", () => {
    it("dos compras a precios distintos dan el promedio PONDERADO, no el simple", async () => {
      // 10 a $5 y 30 a $9 → (50 + 270) / 40 = 8. El promedio simple daría 7,
      // que es justo el error que este test existe para impedir.
      await asentar({ productId: simpleId, quantity: "10", unitCost: "5.00" });
      await asentar({ productId: simpleId, quantity: "30", unitCost: "9.00" });

      const costo = await service.averageCost(tenantId, simpleId);

      expect(costo?.toString()).toBe("8");
    });

    it("una compra por CAJA se normaliza a la unidad base con el factor", async () => {
      // $120 la caja de 12 = $10 la pieza. La cantidad ya viene en base (24).
      await asentar({
        productId: porCajaId,
        quantity: "24",
        unitCost: "120.00",
        presentationId: cajaPresentationId,
      });

      const costo = await service.averageCost(tenantId, porCajaId);

      expect(costo?.toString()).toBe("10");
    });

    it("mezcla de presentaciones: cada una entra a su costo por unidad base", async () => {
      // Ya hay 24 piezas a $10 (la caja de arriba). Sumamos 6 piezas a $16
      // → (240 + 96) / 30 = 11.2
      await asentar({
        productId: porCajaId,
        quantity: "6",
        unitCost: "16.00",
        presentationId: piezaPresentationId,
      });

      const costo = await service.averageCost(tenantId, porCajaId);

      expect(costo?.toString()).toBe("11.2");
    });

    /**
     * Sin presentación el `unit_cost` YA está en la unidad base: dividir por
     * un factor inventado sería peor que no dividir.
     */
    it("sin presentación, el costo se toma tal cual (factor 1)", async () => {
      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.create({
          data: { tenantId, sku: `CB-${Date.now()}`, name: "Base directa" },
        }),
      );
      await asentar({ productId: producto.id, quantity: "5", unitCost: "7.00" });

      expect((await service.averageCost(tenantId, producto.id))?.toString()).toBe("7");
    });
  });

  describe("qué NO cuenta", () => {
    /**
     * ⚠ El corazón de «promedio de COMPRAS». Un ajuste que sube stock no dice
     * cuánto costó la mercancía, y dejarlo entrar con costo cero derrumbaría
     * el promedio sin que nadie entienda por qué.
     */
    it("un ajuste, una devolución y un traspaso NO mueven el promedio", async () => {
      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.create({ data: { tenantId, sku: `CX-${Date.now()}`, name: "Con ruido" } }),
      );
      await asentar({ productId: producto.id, quantity: "10", unitCost: "5.00" });
      const limpio = await service.averageCost(tenantId, producto.id);

      await asentar({
        productId: producto.id,
        quantity: "100",
        unitCost: "999.00",
        reasonCode: "adjustment",
      });
      await asentar({
        productId: producto.id,
        quantity: "100",
        unitCost: "999.00",
        reasonCode: "customer_return",
      });
      const destino = await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.create({
          data: {
            tenantId,
            code: `WH-${Math.random().toString(36).slice(2, 10)}`,
            name: `Destino ${Date.now()}`,
          },
        }),
      );
      await asentar({
        productId: producto.id,
        quantity: "100",
        unitCost: "999.00",
        reasonCode: "transfer",
        linkedWarehouseId: destino.id,
      });

      expect((await service.averageCost(tenantId, producto.id))?.toString()).toBe(
        limpio?.toString(),
      );
    });

    /**
     * Escrito primero como «una salida por factura tampoco cuenta» y corregido
     * al chocar con la realidad: **la base no permite esa fila**. El CHECK
     * `stock_movements_direction_reason_check` (migración
     * `20260818013308_f3_stock_movements`) lista `invoice` solo del lado de
     * las entradas.
     *
     * Se deja como test porque de esa garantía depende una decisión del
     * servicio: si mañana alguien relajara el CHECK para permitir devoluciones
     * al proveedor, esas salidas empezarían a entrar al promedio como si
     * fueran compras. Acá se entera.
     */
    it("la base IMPIDE una salida por factura: `invoice` es solo de entradas", async () => {
      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.create({ data: { tenantId, sku: `CD-${Date.now()}`, name: "Devuelto" } }),
      );

      await expect(
        asentar({
          productId: producto.id,
          quantity: "10",
          unitCost: "50.00",
          reasonCode: "invoice",
          direction: "exit",
        }),
      ).rejects.toThrow(/direction_reason_check/);
    });

    it("una entrada por factura SIN costo capturado se ignora, no cuenta como cero", async () => {
      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.create({ data: { tenantId, sku: `CZ-${Date.now()}`, name: "Sin costo" } }),
      );
      await asentar({ productId: producto.id, quantity: "10", unitCost: "5.00" });
      await asentar({ productId: producto.id, quantity: "90", unitCost: null });

      // Con el null contando como 0 el promedio caería a 0.50.
      expect((await service.averageCost(tenantId, producto.id))?.toString()).toBe("5");
    });
  });

  describe("sin historial", () => {
    it("un producto nunca comprado devuelve null, NO cero", async () => {
      // Un 0 se sumaría al valor del inventario y lo haría mentir. Quien
      // consume decide su fallback; el servicio no inventa un número.
      expect(await service.averageCost(tenantId, sinHistorialId)).toBeNull();
    });
  });

  describe("el promedio es GLOBAL, no por almacén", () => {
    /**
     * Decisión de Carlos (2026-08-21): un traspaso no cambia lo que costó la
     * mercancía. Si un día cada sucursal compra a precios muy distintos, se
     * migra a por-almacén.
     */
    it("compras en dos almacenes se promedian juntas", async () => {
      const otro = await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.create({
          data: {
            tenantId,
            code: `WH-${Math.random().toString(36).slice(2, 10)}`,
            name: `Norte cost ${Date.now()}`,
          },
        }),
      );
      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.create({ data: { tenantId, sku: `CG-${Date.now()}`, name: "Dos bodegas" } }),
      );

      await asentar({ productId: producto.id, quantity: "10", unitCost: "5.00" });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.create({
          data: {
            tenantId,
            documentId,
            productId: producto.id,
            warehouseId: otro.id,
            direction: "entry",
            reasonCode: "invoice",
            quantity: "10",
            unitCost: "15.00",
            createdBy: userId,
          },
        }),
      );

      expect((await service.averageCost(tenantId, producto.id))?.toString()).toBe("10");
    });
  });

  describe("varios productos de una sola consulta", () => {
    /**
     * El reporte de stock valoriza CIENTOS de filas: pedir el promedio de a
     * uno sería N+1 contra el libro mayor entero.
     */
    it("averageCosts devuelve un mapa y omite a los que no tienen historial", async () => {
      const mapa = await service.averageCosts(tenantId, [simpleId, sinHistorialId, porCajaId]);

      expect(mapa.get(simpleId)?.toString()).toBe("8");
      expect(mapa.get(porCajaId)?.toString()).toBe("11.2");
      // Ausente, no en cero: el consumidor distingue «no sé» de «vale nada».
      expect(mapa.has(sinHistorialId)).toBe(false);
    });

    it("una lista vacía no consulta y devuelve un mapa vacío", async () => {
      expect((await service.averageCosts(tenantId, [])).size).toBe(0);
    });
  });
});
