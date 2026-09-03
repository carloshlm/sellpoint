import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { WeightedCostService } from "../cost/weighted-cost.service";
import { DashboardInventoryService } from "./dashboard-inventory.service";
import { DashboardPaymentsService } from "./dashboard-payments.service";
import { DashboardProductsService } from "./dashboard-products.service";
import { DashboardSeriesService } from "./dashboard-series.service";

/**
 * F5-DASH-04/05/06/07 — los widgets del panel (integration, Postgres real +
 * reloj falso: 15-mar-2026 12:00 CDMX, el mismo instante de F5-DASH-03).
 *
 * Un solo escenario sembrado con alevosía alimenta a los cuatro: cada venta,
 * movimiento y saldo existe para probar un borde con nombre.
 */
describe("Los widgets del dashboard (integration)", () => {
  let prisma: PrismaService;
  const AHORA = new Date("2026-03-15T18:00:00.000Z");
  const relojFalso = { now: () => AHORA };
  let series: DashboardSeriesService;
  let productos: DashboardProductsService;
  let inventario: DashboardInventoryService;
  let pagos: DashboardPaymentsService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    series = new DashboardSeriesService(prisma, relojFalso);
    productos = new DashboardProductsService(prisma, relojFalso);
    inventario = new DashboardInventoryService(prisma, new WeightedCostService(prisma), relojFalso);
    pagos = new DashboardPaymentsService(prisma, relojFalso);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  interface Ctx {
    tenantId: string;
    warehouseId: string;
    productoA: string;
    productoB: string;
    usuarioId: string;
    sesionId: string;
  }

  async function escenario(): Promise<Ctx> {
    const tenant = await prisma.tenant.create({
      data: { name: `Widgets ${randomUUID().slice(0, 6)}`, timezone: "America/Mexico_City" },
    });
    return prisma.withTenantContext(tenant.id, async (tx) => {
      const usuario = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: `w-${randomUUID()}@example.com`,
          firstName: "Ana",
          lastNamePaternal: "Pérez",
        },
      });
      const almacen = await tx.warehouse.create({
        data: {
          tenantId: tenant.id,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: "Central",
        },
      });
      const a = await tx.product.create({
        data: {
          tenantId: tenant.id,
          sku: `A-${randomUUID().slice(0, 6)}`,
          name: "Agua 1L",
          stockMin: 20,
        },
      });
      const b = await tx.product.create({
        data: {
          tenantId: tenant.id,
          sku: `B-${randomUUID().slice(0, 6)}`,
          name: "Botana",
          stockMin: 15,
        },
      });
      const sesion = await tx.cashboxSession.create({
        data: { tenantId: tenant.id, warehouseId: almacen.id, openedBy: usuario.id },
      });
      return {
        tenantId: tenant.id,
        warehouseId: almacen.id,
        productoA: a.id,
        productoB: b.id,
        usuarioId: usuario.id,
        sesionId: sesion.id,
      };
    });
  }

  interface Venta {
    creadaEn: string;
    productoId?: string;
    servicioId?: string;
    quantity: number;
    unitPrice: number;
    unitCost?: number;
    method?: "cash" | "card" | "transfer";
  }

  async function vender(ctx: Ctx, v: Venta): Promise<void> {
    const total = v.unitPrice * v.quantity;
    await prisma.withTenantContext(ctx.tenantId, (tx) =>
      tx.sale.create({
        data: {
          tenantId: ctx.tenantId,
          folio: `W-${randomUUID().slice(0, 12)}`,
          warehouseId: ctx.warehouseId,
          cashboxSessionId: ctx.sesionId,
          paymentMethod: v.method ?? "cash",
          status: "completed",
          subtotal: total,
          discount: 0,
          total,
          createdBy: ctx.usuarioId,
          createdAt: new Date(v.creadaEn),
          items: {
            create: [
              {
                tenantId: ctx.tenantId,
                lineNo: 1,
                // F4-CONCEPT-02: la forma de la línea la cierra el CHECK por kind.
                kind: v.servicioId !== undefined ? "service" : "product",
                ...(v.productoId !== undefined && { productId: v.productoId }),
                ...(v.servicioId !== undefined && { serviceId: v.servicioId }),
                quantity: v.quantity,
                unitPrice: v.unitPrice,
                discount: 0,
                lineTotal: total,
                ...(v.unitCost !== undefined && { unitCost: v.unitCost }),
              },
            ],
          },
        },
      }),
    );
  }

  const USER = (ctx: Ctx, permisos: string[] = ["reports:read"]) =>
    ({ tenantId: ctx.tenantId, permissions: permisos }) as never;
  const TODO = { warehouseIds: "all" } as never;

  it("series: los días son locales, las dos series se alinean y las 24 horas van completas", async () => {
    const ctx = await escenario();
    // 05:30Z del 15 = 23:30 LOCAL del 14: debe caer en el día 14.
    await vender(ctx, {
      creadaEn: "2026-03-15T05:30:00Z",
      productoId: ctx.productoA,
      quantity: 1,
      unitPrice: 500,
    });
    await vender(ctx, {
      creadaEn: "2026-03-15T17:00:00Z",
      productoId: ctx.productoA,
      quantity: 1,
      unitPrice: 200,
    });
    await vender(ctx, {
      creadaEn: "2026-02-10T18:00:00Z",
      productoId: ctx.productoA,
      quantity: 1,
      unitPrice: 100,
    });

    const r = await series.series(USER(ctx), TODO);

    expect(r.byDay).toHaveLength(31); // marzo 31 vs febrero 28: manda el largo
    expect(r.byDay[13]).toEqual({ day: 14, current: "500.00", previous: "0" });
    expect(r.byDay[14]).toEqual({ day: 15, current: "200.00", previous: "0" });
    expect(r.byDay[9]?.previous).toBe("100.00");
    expect(r.byHour).toHaveLength(24);
    // 17:00Z = 11:00 local; la de 23:30 local del 14 NO es de hoy.
    expect(r.byHour[11]).toEqual({ hour: 11, total: "200.00" });
    expect(r.byHour.reduce((n, h) => n + Number(h.total), 0)).toBe(200);
  });

  it("tops: el más vendido no es el que más deja — y la Δ% alimenta la alerta de crecimiento", async () => {
    const ctx = await escenario();
    // A: mucho volumen, margen chico (precio 10, costo 9). 30 unidades hoy.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      productoId: ctx.productoA,
      quantity: 30,
      unitPrice: 10,
      unitCost: 9,
    });
    // B: poco volumen, margen gordo (precio 100, costo 20). 5 unidades.
    await vender(ctx, {
      creadaEn: "2026-03-14T19:00:00Z",
      productoId: ctx.productoB,
      quantity: 5,
      unitPrice: 100,
      unitCost: 20,
    });
    // Historia previa de B para la delta del mes: en feb corrido vendió 250.
    await vender(ctx, {
      creadaEn: "2026-02-10T18:00:00Z",
      productoId: ctx.productoB,
      quantity: 5,
      unitPrice: 50,
      unitCost: 20,
    });
    // Y un tercero SIN costo congelado: vende muchísimo, pero de su utilidad
    // no se sabe nada — no puede colarse al top de utilidad.
    const sinCosto = await prisma.withTenantContext(ctx.tenantId, (tx) =>
      tx.product.create({
        data: { tenantId: ctx.tenantId, sku: `C-${randomUUID().slice(0, 6)}`, name: "Misterio" },
      }),
    );
    await vender(ctx, {
      creadaEn: "2026-03-14T20:00:00Z",
      productoId: sinCosto.id,
      quantity: 50,
      unitPrice: 40,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    // Por unidades manda Misterio (50), luego A (30)…
    expect(r.topSold[1]?.name).toBe("Agua 1L");
    expect(r.topSold[1]?.units).toBe("30.0000");
    // …pero por utilidad manda B: 500−100=400 contra 300−270=30.
    expect(r.topProfit[0]?.name).toBe("Botana");
    expect(r.topProfit[0]?.profit).toBe("400.00");
    expect(r.topProfit[0]?.marginPct).toBe(80);
    // El top de utilidad solo admite líneas CON snapshot: el que vende mucho
    // sin costo conocido encabeza los vendidos, pero de utilidad no dice nada.
    expect(r.topSold[0]?.name).toBe("Misterio");
    expect(r.topProfit.map((f) => f.name)).not.toContain("Misterio");
    expect(r.topProfit).toHaveLength(2);
    // La delta de B: 500 ahora vs 250 en febrero corrido → +100%.
    expect(r.topSold.find((p) => p.name === "Botana")?.deltaPct).toBe(100);
    // A no tiene historia previa: null, no un +∞ disfrazado.
    expect(r.topSold[1]?.deltaPct).toBeNull();
  });

  it("los SERVICIOS compiten en los dos tops: también son ventas y también dejan (Carlos, 2026-09-01)", async () => {
    const ctx = await escenario();
    const servicio = await prisma.withTenantContext(ctx.tenantId, (tx) =>
      tx.service.create({
        data: {
          tenantId: ctx.tenantId,
          code: `CON-${randomUUID().slice(0, 6)}`,
          name: "Consulta Médica",
          cost: "10",
          price: "50",
        },
      }),
    );
    // 8 consultas a $50 con costo $10 → venta 400, utilidad 320.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      servicioId: servicio.id,
      quantity: 8,
      unitPrice: 50,
      unitCost: 10,
    });
    // Un producto que vende más pero deja menos: 20 × $30 con costo $28.
    await vender(ctx, {
      creadaEn: "2026-03-14T19:00:00Z",
      productoId: ctx.productoA,
      quantity: 20,
      unitPrice: 30,
      unitCost: 28,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    // Más vendidos por unidades: el producto (20) sobre la consulta (8)…
    expect(r.topSold[0]?.name).toBe("Agua 1L");
    expect(r.topSold[1]?.name).toBe("Consulta Médica");
    // …pero en utilidad la consulta arrasa: 320 contra 40.
    expect(r.topProfit[0]?.name).toBe("Consulta Médica");
    expect(r.topProfit[0]?.profit).toBe("320.00");
    expect(r.topProfit[0]?.marginPct).toBe(80);
  });

  it("inventario: cuenta agotados y bajos, predice días y el valor solo viaja con reports:read", async () => {
    const ctx = await escenario();
    await prisma.withTenantContext(ctx.tenantId, async (tx) => {
      // A: 6 en stock con mínimo 20 → bajo mínimo. B: 0 con mínimo 15 → agotado.
      await tx.stockByWarehouse.create({
        data: {
          tenantId: ctx.tenantId,
          productId: ctx.productoA,
          warehouseId: ctx.warehouseId,
          quantity: 6,
        },
      });
      // El kardex exige documento XOR venta: anclas mínimas para las semillas.
      const ventaAncla = await tx.sale.create({
        data: {
          tenantId: ctx.tenantId,
          folio: `WA-${randomUUID().slice(0, 10)}`,
          warehouseId: ctx.warehouseId,
          cashboxSessionId: ctx.sesionId,
          paymentMethod: "cash",
          status: "completed",
          subtotal: 0,
          discount: 0,
          total: 0,
          createdBy: ctx.usuarioId,
          createdAt: new Date("2026-03-10T18:00:00Z"),
        },
      });
      const docAncla = await tx.inventoryDocument.create({
        data: {
          tenantId: ctx.tenantId,
          folio: `WD-${randomUUID().slice(0, 10)}`,
          type: "entry",
          status: "confirmed",
          confirmedBy: ctx.usuarioId,
          confirmedAt: new Date("2026-03-01T18:00:00Z"),
          warehouseId: ctx.warehouseId,
          reasonCode: "invoice",
          reference: "F-1",
          createdBy: ctx.usuarioId,
        },
      });
      // La velocidad de A: vendió 28 en 14 días (2/día) → 6/2 = 3 días.
      await tx.stockMovement.create({
        data: {
          tenantId: ctx.tenantId,
          productId: ctx.productoA,
          warehouseId: ctx.warehouseId,
          direction: "exit",
          reasonCode: "sale",
          saleId: ventaAncla.id,
          quantity: 28,
          createdBy: ctx.usuarioId,
          createdAt: new Date("2026-03-10T18:00:00Z"),
        },
      });
      // Compra con costo para valorizar: A costó $7 la unidad.
      await tx.stockMovement.create({
        data: {
          tenantId: ctx.tenantId,
          productId: ctx.productoA,
          warehouseId: ctx.warehouseId,
          direction: "entry",
          reasonCode: "invoice",
          documentId: docAncla.id,
          quantity: 34,
          unitCost: 7,
          createdBy: ctx.usuarioId,
          createdAt: new Date("2026-03-01T18:00:00Z"),
        },
      });
    });

    const conDinero = await inventario.inventory(
      USER(ctx, ["inventory:read", "reports:read"]),
      TODO,
    );
    const sinDinero = await inventario.inventory(USER(ctx, ["inventory:read"]), TODO);

    expect(conDinero.outOfStock).toBe(1);
    expect(conDinero.belowMin).toBe(1);
    // 6 unidades × $7 = $42 (sin ceros de cola: así emite el módulo entero).
    // B sin costo conocido no inventa valor.
    expect(conDinero.inventoryValue).toBe("42");
    expect(sinDinero.inventoryValue).toBeUndefined();
    // A la cabeza el que YA se acabó: B agotado dice 0 días — con o sin ritmo,
    // lo que está en cero no tiene «no se sabe cuándo se acaba»: ya se acabó
    // (Carlos, 2026-09-01). A, con ritmo, conserva sus 3 días.
    expect(conDinero.attention[0]?.daysLeft).toBe(0);
    expect(conDinero.attention[1]?.daysLeft).toBe(3);
  });

  /**
   * Carlos (2026-09-01): un producto con stock NEGATIVO (vendido sin
   * existencias) mostraba «−14 días restantes» — un plazo negativo no
   * significa nada para quien repone. Stock en cero o abajo = 0 días, y el
   * front lo pinta en rojo (0 ≤ 3).
   */
  it("inventario: stock negativo o en cero dice 0 días restantes, nunca un número negativo", async () => {
    const ctx = await escenario();
    await prisma.withTenantContext(ctx.tenantId, async (tx) => {
      // A quedó en −5 (se vendió sin existencias) y TIENE ritmo de venta.
      await tx.stockByWarehouse.create({
        data: {
          tenantId: ctx.tenantId,
          productId: ctx.productoA,
          warehouseId: ctx.warehouseId,
          quantity: -5,
        },
      });
      const ventaAncla = await tx.sale.create({
        data: {
          tenantId: ctx.tenantId,
          folio: `WN-${randomUUID().slice(0, 10)}`,
          warehouseId: ctx.warehouseId,
          cashboxSessionId: ctx.sesionId,
          paymentMethod: "cash",
          subtotal: 0,
          total: 0,
          createdBy: ctx.usuarioId,
          status: "completed",
        },
      });
      await tx.stockMovement.create({
        data: {
          tenantId: ctx.tenantId,
          productId: ctx.productoA,
          warehouseId: ctx.warehouseId,
          direction: "exit",
          reasonCode: "sale",
          saleId: ventaAncla.id,
          quantity: 28,
          createdBy: ctx.usuarioId,
          createdAt: new Date("2026-03-10T18:00:00Z"),
        },
      });
    });

    const r = await inventario.inventory(USER(ctx, ["inventory:read"]), TODO);

    const filaA = r.attention.find((f) => f.productId === ctx.productoA);
    // Con ritmo y stock −5, la división daría −2.5: se dice 0, que es la
    // verdad útil — no queda nada que vender.
    expect(filaA?.daysLeft).toBe(0);
  });

  it("métodos de pago: los % suman 100 y el dominante encabeza; sin ventas, lista vacía", async () => {
    const ctx = await escenario();
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      productoId: ctx.productoA,
      quantity: 1,
      unitPrice: 620,
      method: "cash",
    });
    await vender(ctx, {
      creadaEn: "2026-03-14T19:00:00Z",
      productoId: ctx.productoA,
      quantity: 1,
      unitPrice: 380,
      method: "card",
    });

    const r = await pagos.paymentMethods(USER(ctx), TODO, "month");
    expect(r.methods).toEqual([
      { method: "cash", total: "620", pct: 62 },
      { method: "card", total: "380", pct: 38 },
    ]);

    const vacio = await escenario();
    const sinVentas = await pagos.paymentMethods(USER(vacio), TODO, "month");
    expect(sinVentas.methods).toEqual([]);
  });
});
