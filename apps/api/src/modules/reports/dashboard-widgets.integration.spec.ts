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
          lastName: "Pérez",
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
        data: {
          folio: `TUR-${randomUUID().slice(0, 8)}`,
          tenantId: tenant.id,
          warehouseId: almacen.id,
          openedBy: usuario.id,
        },
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
    /** F4-CONCEPT-07: una línea de concepto (sin producto ni servicio). */
    concepto?: string;
    /** En qué presentación se tecleó la cantidad (Caja ×12, Porción 250 g…). */
    presentacionId?: string;
    quantity: number;
    unitPrice: number;
    unitCost?: number;
    /** F4-TAX-20: el impuesto que viaja dentro del line_total. */
    taxAmount?: number;
    method?: "cash" | "card" | "transfer";
  }

  /** Devuelve el id de la venta, para cancelarla cuando el caso lo pide. */
  async function vender(ctx: Ctx, v: Venta): Promise<string> {
    const total = v.unitPrice * v.quantity;
    const venta = await prisma.withTenantContext(ctx.tenantId, (tx) =>
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
                kind:
                  v.concepto !== undefined
                    ? "concept"
                    : v.servicioId !== undefined
                      ? "service"
                      : "product",
                ...(v.productoId !== undefined && { productId: v.productoId }),
                ...(v.servicioId !== undefined && { serviceId: v.servicioId }),
                ...(v.concepto !== undefined && { conceptDescription: v.concepto }),
                ...(v.presentacionId !== undefined && { presentationId: v.presentacionId }),
                quantity: v.quantity,
                unitPrice: v.unitPrice,
                discount: 0,
                lineTotal: total,
                ...(v.unitCost !== undefined && { unitCost: v.unitCost }),
                ...(v.taxAmount !== undefined && { taxAmount: v.taxAmount }),
              },
            ],
          },
        },
      }),
    );
    return venta.id;
  }

  async function cancelar(ctx: Ctx, ventaId: string): Promise<void> {
    await prisma.withTenantContext(ctx.tenantId, (tx) =>
      tx.sale.update({
        where: { id: ventaId },
        data: {
          status: "canceled",
          canceledAt: new Date("2026-03-14T21:00:00Z"),
          canceledBy: ctx.usuarioId,
          cancelReason: "Prueba",
        },
      }),
    );
  }

  /** Un producto o servicio más, con el nombre que el caso necesita leer. */
  async function articulo(ctx: Ctx, tipo: "product" | "service", nombre: string): Promise<string> {
    const clave = `${nombre.slice(0, 3).toUpperCase()}-${randomUUID().slice(0, 6)}`;
    return prisma.withTenantContext(ctx.tenantId, async (tx) =>
      tipo === "product"
        ? (await tx.product.create({ data: { tenantId: ctx.tenantId, sku: clave, name: nombre } }))
            .id
        : (await tx.service.create({ data: { tenantId: ctx.tenantId, code: clave, name: nombre } }))
            .id,
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
    // F10-KPI-03: ninguna venta cayó en un domingo anterior, así que la hora
    // no tiene referencia.
    expect(r.byHour[11]).toEqual({ hour: 11, total: "200.00", reference: null });
    expect(r.byHour.reduce((n, h) => n + Number(h.total), 0)).toBe(200);
  });

  /**
   * F10-KPI-03 — la referencia de «Ventas de hoy por hora»: el promedio, por
   * hora local, del mismo día de la semana en las cuatro semanas anteriores.
   * El reloj marca el domingo 15 de marzo a las 12:00 de CDMX (UTC−6): los
   * domingos que cuentan son el 8 y el 1 de marzo y el 22 y el 15 de febrero.
   */
  describe("F10-KPI-03: la serie por hora trae su referencia", () => {
    it("cuatro domingos sembrados dan el promedio de cada hora; otro día o una quinta semana no entran", async () => {
      const ctx = await escenario();
      const venta = (creadaEn: string, unitPrice: number) =>
        vender(ctx, { creadaEn, productoId: ctx.productoA, quantity: 1, unitPrice });
      // A las 11:00 locales (17:00Z) de los cuatro domingos: 100, 200, 300 y 400.
      await venta("2026-03-08T17:00:00Z", 100);
      await venta("2026-03-01T17:00:00Z", 200);
      await venta("2026-02-22T17:00:00Z", 300);
      await venta("2026-02-15T17:00:00Z", 400);
      // A las 15:00 locales, solo un domingo: el promedio la reparte entre cuatro.
      await venta("2026-02-22T21:00:00Z", 80);
      // Fuera: el domingo de hace cinco semanas y el sábado de ayer.
      await venta("2026-02-08T17:00:00Z", 1000);
      await venta("2026-03-14T17:00:00Z", 1000);
      // Lo de hoy es la barra, no la referencia.
      await venta("2026-03-15T16:00:00Z", 50);

      const r = await series.series(USER(ctx), TODO);

      expect(r.byHour[11]).toEqual({ hour: 11, total: "0", reference: "250.00" });
      expect(r.byHour[15]?.reference).toBe("20.00");
      expect(r.byHour[10]).toEqual({ hour: 10, total: "50.00", reference: "0" });
      // Con historia, las 24 horas traen su cifra: un hueco es un "0".
      expect(r.byHour.every((h) => h.reference !== null)).toBe(true);
      expect(r.byHour.reduce((n, h) => n + Number(h.reference), 0)).toBe(270);
    });

    it("una venta a las 23:30 locales cae en su día y en su hora, no en los de UTC", async () => {
      const ctx = await escenario();
      // 05:30Z del lunes 9 = 23:30 del DOMINGO 8 en CDMX: cuenta, en la hora 23.
      await vender(ctx, {
        creadaEn: "2026-03-09T05:30:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 120,
      });
      // 05:30Z del domingo 8 = 23:30 del SÁBADO 7 en CDMX: no cuenta.
      await vender(ctx, {
        creadaEn: "2026-03-08T05:30:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 999,
      });

      const r = await series.series(USER(ctx), TODO);

      expect(r.byHour[23]?.reference).toBe("120.00");
      expect(r.byHour[5]?.reference).toBe("0");
      expect(r.byHour.reduce((n, h) => n + Number(h.reference), 0)).toBe(120);
    });

    it("un domingo sin ventas no entra al divisor: un día cerrado no baja el promedio", async () => {
      const ctx = await escenario();
      await vender(ctx, {
        creadaEn: "2026-03-08T17:00:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 100,
      });
      await vender(ctx, {
        creadaEn: "2026-03-01T17:00:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 300,
      });
      // El 22 y el 15 de febrero, cerrado.

      const r = await series.series(USER(ctx), TODO);

      // (100 + 300) / 2 domingos con venta, no / 4.
      expect(r.byHour[11]?.reference).toBe("200.00");
    });

    it("una venta cancelada no suma, y un domingo con puras canceladas no cuenta como día con venta", async () => {
      const ctx = await escenario();
      await vender(ctx, {
        creadaEn: "2026-03-08T17:00:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 100,
      });
      const cancelada = await vender(ctx, {
        creadaEn: "2026-03-08T17:10:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 900,
      });
      await cancelar(ctx, cancelada);
      const otraCancelada = await vender(ctx, {
        creadaEn: "2026-03-01T17:00:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 500,
      });
      await cancelar(ctx, otraCancelada);

      const r = await series.series(USER(ctx), TODO);

      expect(r.byHour[11]?.reference).toBe("100.00");
    });

    it("un negocio sin historia da null en las 24 horas, no «0»", async () => {
      const ctx = await escenario();
      // Vende hoy y vendió ayer (sábado), pero ningún domingo anterior.
      await vender(ctx, {
        creadaEn: "2026-03-15T16:00:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 50,
      });
      await vender(ctx, {
        creadaEn: "2026-03-14T17:00:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 70,
      });

      const r = await series.series(USER(ctx), TODO);

      expect(r.byHour).toHaveLength(24);
      expect(r.byHour.every((h) => h.reference === null)).toBe(true);
      expect(r.byHour[10]).toEqual({ hour: 10, total: "50.00", reference: null });
    });

    it("con el alcance limitado a una sucursal, la referencia solo promedia sus ventas", async () => {
      const ctx = await escenario();
      const otra = await prisma.withTenantContext(ctx.tenantId, (tx) =>
        tx.warehouse.create({
          data: {
            tenantId: ctx.tenantId,
            code: `WH-${Math.random().toString(36).slice(2, 10)}`,
            name: "Norte",
          },
        }),
      );
      await vender(ctx, {
        creadaEn: "2026-03-08T17:00:00Z",
        productoId: ctx.productoA,
        quantity: 1,
        unitPrice: 100,
      });
      await vender(
        { ...ctx, warehouseId: otra.id },
        {
          creadaEn: "2026-03-01T17:00:00Z",
          productoId: ctx.productoA,
          quantity: 1,
          unitPrice: 500,
        },
      );

      const central = await series.series(USER(ctx), {
        warehouseIds: [ctx.warehouseId],
      } as never);
      const todas = await series.series(USER(ctx), TODO);

      // En Central solo el 8 tuvo venta: 100 / 1. Con las dos, (100 + 500) / 2.
      expect(central.byHour[11]?.reference).toBe("100.00");
      expect(todas.byHour[11]?.reference).toBe("300.00");
    });
  });

  it("tops: lo vendido se cuenta en la UNIDAD BASE del producto — el queso en kg, la caja ×12 en piezas", async () => {
    const ctx = await escenario();
    // Queso por kilo, despachado en porciones de 250 g: 31 porciones = 7.75 kg,
    // no «31 unidades» (Carlos, 2026-09-21).
    const queso = await prisma.withTenantContext(ctx.tenantId, (tx) =>
      tx.product.create({
        data: {
          tenantId: ctx.tenantId,
          sku: `Q-${randomUUID().slice(0, 6)}`,
          name: "Queso mozzarella",
          baseUnit: "kg",
          presentations: {
            create: [
              {
                tenantId: ctx.tenantId,
                name: "Porción 250 g",
                factor: 0.25,
                allowFractionalInput: true,
              },
            ],
          },
        },
        include: { presentations: true },
      }),
    );
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      productoId: queso.id,
      presentacionId: queso.presentations[0]?.id as string,
      quantity: 31,
      unitPrice: 52.5,
    });
    // El agua: 2 cajas de 12 más 3 piezas sueltas son 27 piezas, no 5.
    const caja = await prisma.withTenantContext(ctx.tenantId, (tx) =>
      tx.productPresentation.create({
        data: {
          tenantId: ctx.tenantId,
          productId: ctx.productoA,
          name: "Caja ×12",
          factor: 12,
          allowFractionalInput: false,
        },
      }),
    );
    await vender(ctx, {
      creadaEn: "2026-03-14T18:30:00Z",
      productoId: ctx.productoA,
      presentacionId: caja.id,
      quantity: 2,
      unitPrice: 300,
    });
    await vender(ctx, {
      creadaEn: "2026-03-14T18:40:00Z",
      productoId: ctx.productoA,
      quantity: 3,
      unitPrice: 28,
    });
    await vender(ctx, {
      creadaEn: "2026-03-14T19:00:00Z",
      concepto: "Flete a domicilio",
      quantity: 1,
      unitPrice: 80,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    const delQueso = r.topSold.find((f) => f.name === "Queso mozzarella");
    expect(delQueso).toMatchObject({ units: "7.7500", unit: "kg" });
    const delAgua = r.topSold.find((f) => f.name === "Agua 1L");
    expect(delAgua).toMatchObject({ units: "27.0000", unit: "unit" });
    // Un concepto (y un servicio) no tiene unidad de medida: se cuenta.
    expect(r.topSold.find((f) => f.name === "Flete a domicilio")).toMatchObject({
      units: "1.0000",
      unit: "unit",
    });
    // El orden es por IMPORTE: 7.75 kg de queso ($1,627.50) venden más que 27
    // piezas de agua ($684). Piezas contra kilos no se pueden comparar; pesos sí.
    expect(r.topSold.map((f) => f.name)).toEqual([
      "Queso mozzarella",
      "Agua 1L",
      "Flete a domicilio",
    ]);
  });

  it("tops: «más vendido» es el que más DINERO vende — poco queso caro le gana a muchas fotocopias (F5-DASH-18)", async () => {
    const ctx = await escenario();
    // El caso real de Carlos (2026-09-21): 253 fotocopias de $2 quedaban en
    // primer lugar y 5.3 kg de queso de $540 en octavo, vendiendo cinco veces más.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      concepto: "Fotocopia",
      quantity: 253,
      unitPrice: 2,
    });
    const queso = await prisma.withTenantContext(ctx.tenantId, (tx) =>
      tx.product.create({
        data: {
          tenantId: ctx.tenantId,
          sku: `QO-${randomUUID().slice(0, 6)}`,
          name: "Queso Oaxaca",
          baseUnit: "kg",
        },
      }),
    );
    await vender(ctx, {
      creadaEn: "2026-03-14T19:00:00Z",
      productoId: queso.id,
      quantity: 5.3,
      unitPrice: 540,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    expect(r.topSold.map((f) => f.name)).toEqual(["Queso Oaxaca", "Fotocopia"]);
    expect(r.topSold[0]).toMatchObject({ units: "5.3000", unit: "kg", revenue: "2862.00" });
    expect(r.topSold[1]).toMatchObject({ units: "253.0000", unit: "unit", revenue: "506.00" });
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

    // Por IMPORTE manda Misterio (2000), luego B (500) y al final A (300): A
    // mueve más piezas que B, pero B vende más dinero (F5-DASH-18).
    expect(r.topSold.map((f) => f.name)).toEqual(["Misterio", "Botana", "Agua 1L"]);
    expect(r.topSold[2]?.units).toBe("30.0000");
    // …y por utilidad manda B: 500−100=400 contra 300−270=30.
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
    expect(r.topSold.find((p) => p.name === "Agua 1L")?.deltaPct).toBeNull();
  });

  it("F4-TAX-20: el impuesto no es ingreso — el revenue y la utilidad del top van sobre la base", async () => {
    const ctx = await escenario();
    // 5 × 112 con 60 de impuesto adentro (base 500), costo 20 × 5 = 100.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      productoId: ctx.productoB,
      quantity: 5,
      unitPrice: 112,
      unitCost: 20,
      taxAmount: 60,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    expect(r.topSold[0]?.revenue).toBe("500.00");
    expect(r.topProfit[0]?.profit).toBe("400.00");
    expect(r.topProfit[0]?.marginPct).toBe(80);
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

    // Más vendidos por importe: el producto (600) sobre la consulta (400)…
    expect(r.topSold[0]?.name).toBe("Agua 1L");
    expect(r.topSold[1]?.name).toBe("Consulta Médica");
    // …pero en utilidad la consulta arrasa: 320 contra 40.
    expect(r.topProfit[0]?.name).toBe("Consulta Médica");
    expect(r.topProfit[0]?.profit).toBe("320.00");
    expect(r.topProfit[0]?.marginPct).toBe(80);
  });

  /**
   * F4-CONCEPT-07 — un concepto no tiene id de catálogo: su identidad en el
   * reporte es su descripción. Cuenta en «más vendidos» y NUNCA en utilidad
   * (no tiene costo: `unit_cost IS NULL`).
   */
  it("un CONCEPTO cuenta en más vendidos por su descripción y no en utilidad", async () => {
    const ctx = await escenario();
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      concepto: "Flete a domicilio",
      quantity: 3,
      unitPrice: 150,
    });
    await vender(ctx, {
      creadaEn: "2026-03-14T19:00:00Z",
      productoId: ctx.productoA,
      quantity: 2,
      unitPrice: 30,
      unitCost: 28,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    const flete = r.topSold.find((f) => f.name === "Flete a domicilio");
    // Los agregados salen con la escala de la columna; lo que importa es el número.
    expect(Number(flete?.units)).toBe(3);
    expect(Number(flete?.revenue)).toBe(450);
    expect(r.topProfit.map((f) => f.name)).not.toContain("Flete a domicilio");
    expect(r.topProfit[0]?.name).toBe("Agua 1L");
  });

  /**
   * F10-KPI-01 — una pérdida no es un «top»: es una noticia. En el panel de
   * Carlos del 19 de septiembre, «Fotocopia» salió en «Mayor utilidad» con
   * −248.8% de margen y −$2.14.
   */
  it("F10-KPI-01: «Mayor utilidad» solo lista lo que deja; lo vendido bajo costo va a `belowCost`", async () => {
    const ctx = await escenario();
    const fotocopia = await articulo(ctx, "service", "Fotocopia");
    const alCosto = await articulo(ctx, "product", "Al costo");
    const cancelado = await articulo(ctx, "product", "Cancelado");
    const deFebrero = await articulo(ctx, "product", "De febrero");

    // Deja: 5 × 100 con costo 20 → utilidad 400.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      productoId: ctx.productoB,
      quantity: 5,
      unitPrice: 100,
      unitCost: 20,
    });
    // El caso de la captura: 1 × 0.86 con costo 3 → −2.14, margen −248.8%.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:10:00Z",
      servicioId: fotocopia,
      quantity: 1,
      unitPrice: 0.86,
      unitCost: 3,
    });
    // La pérdida más grande va primero: 10 × 5 con costo 6 → −10, margen −20%.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:20:00Z",
      productoId: ctx.productoA,
      quantity: 10,
      unitPrice: 5,
      unitCost: 6,
    });
    // Vendido justo a su costo: utilidad cero, no está en ninguna de las dos.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:30:00Z",
      productoId: alCosto,
      quantity: 2,
      unitPrice: 15,
      unitCost: 15,
    });
    // Una venta cancelada no pierde nada, y una de febrero no es de este mes.
    await cancelar(
      ctx,
      await vender(ctx, {
        creadaEn: "2026-03-14T18:40:00Z",
        productoId: cancelado,
        quantity: 1,
        unitPrice: 1,
        unitCost: 100,
      }),
    );
    await vender(ctx, {
      creadaEn: "2026-02-10T18:00:00Z",
      productoId: deFebrero,
      quantity: 1,
      unitPrice: 1,
      unitCost: 100,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    expect(r.topProfit.map((f) => f.name)).toEqual(["Botana"]);
    expect(r.belowCost.map((f) => f.name)).toEqual(["Agua 1L", "Fotocopia"]);
    expect(r.belowCostCount).toBe(2);
    expect(r.belowCost[0]).toMatchObject({
      itemId: ctx.productoA,
      kind: "product",
      revenue: "50.00",
      cost: "60.00",
      profit: "-10.00",
      marginPct: -20,
    });
    expect(r.belowCost[1]).toMatchObject({
      itemId: fotocopia,
      kind: "service",
      revenue: "0.86",
      cost: "3.00",
      profit: "-2.14",
      marginPct: -248.8,
    });
  });

  it("F10-KPI-01: las listas no se rellenan — llegan hasta cinco y el conteo dice cuántos hay", async () => {
    const ctx = await escenario();
    // Uno solo deja: «Mayor utilidad» queda con un renglón, sin pérdidas de relleno.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      productoId: ctx.productoB,
      quantity: 1,
      unitPrice: 50,
      unitCost: 10,
    });
    // Seis pierden (1 a 6 pesos) y seis se venden sin costo (10 a 60 pesos).
    for (let n = 1; n <= 6; n++) {
      await vender(ctx, {
        creadaEn: "2026-03-14T18:00:00Z",
        productoId: await articulo(ctx, "product", `Pierde ${n}`),
        quantity: 1,
        unitPrice: 10,
        unitCost: 10 + n,
      });
      await vender(ctx, {
        creadaEn: "2026-03-14T18:00:00Z",
        productoId: await articulo(ctx, "product", `Sin costo ${n}`),
        quantity: 1,
        unitPrice: 10 * n,
      });
    }

    const r = await productos.products(USER(ctx), TODO, "month");

    expect(r.topProfit.map((f) => f.name)).toEqual(["Botana"]);
    expect(r.belowCost.map((f) => f.name)).toEqual([
      "Pierde 6",
      "Pierde 5",
      "Pierde 4",
      "Pierde 3",
      "Pierde 2",
    ]);
    expect(r.belowCostCount).toBe(6);
    expect(r.uncosted.map((f) => f.name)).toEqual([
      "Sin costo 6",
      "Sin costo 5",
      "Sin costo 4",
      "Sin costo 3",
      "Sin costo 2",
    ]);
    expect(r.uncostedCount).toBe(6);
  });

  it("F10-KPI-01: productos y servicios vendidos sin costo van a `uncosted`; un concepto no", async () => {
    const ctx = await escenario();
    const misterio = await articulo(ctx, "product", "Misterio");
    const corte = await articulo(ctx, "service", "Corte");
    const viejo = await articulo(ctx, "product", "Viejo");

    await vender(ctx, {
      creadaEn: "2026-03-14T18:00:00Z",
      productoId: misterio,
      quantity: 50,
      unitPrice: 40,
    });
    await vender(ctx, {
      creadaEn: "2026-03-14T18:10:00Z",
      servicioId: corte,
      quantity: 3,
      unitPrice: 100,
    });
    // Un concepto libre no tiene ficha donde capturar un costo: no cuenta.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:20:00Z",
      concepto: "Flete a domicilio",
      quantity: 1,
      unitPrice: 150,
    });
    // Agua tiene costo en una venta y no en otra: solo cuenta lo que se vendió sin él.
    await vender(ctx, {
      creadaEn: "2026-03-14T18:30:00Z",
      productoId: ctx.productoA,
      quantity: 2,
      unitPrice: 30,
      unitCost: 28,
    });
    await vender(ctx, {
      creadaEn: "2026-03-14T18:40:00Z",
      productoId: ctx.productoA,
      quantity: 4,
      unitPrice: 25,
    });
    // Fuera del periodo: no es de este mes.
    await vender(ctx, {
      creadaEn: "2026-02-10T18:00:00Z",
      productoId: viejo,
      quantity: 1,
      unitPrice: 500,
    });

    const r = await productos.products(USER(ctx), TODO, "month");

    expect(r.uncosted).toEqual([
      {
        itemId: misterio,
        kind: "product",
        sku: expect.any(String),
        name: "Misterio",
        revenue: "2000.00",
      },
      { itemId: corte, kind: "service", sku: expect.any(String), name: "Corte", revenue: "300.00" },
      {
        itemId: ctx.productoA,
        kind: "product",
        sku: expect.any(String),
        name: "Agua 1L",
        revenue: "100.00",
      },
    ]);
    expect(r.uncostedCount).toBe(3);
    // Lo que sí tiene costo sigue en su lugar.
    expect(r.topProfit.map((f) => f.name)).toEqual(["Agua 1L"]);
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
