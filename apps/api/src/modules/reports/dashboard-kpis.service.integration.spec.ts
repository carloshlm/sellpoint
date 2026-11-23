import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { DashboardKpisService } from "./dashboard-kpis.service";

/**
 * F5-DASH-03 — los cuatro números de arriba del dashboard (integration,
 * Postgres real + RELOJ FALSO).
 *
 * El reloj se congela en un instante elegido con alevosía —15 de marzo de
 * 2026, 12:00 CDMX— porque TODA la matemática de esta pantalla es relativa a
 * «ahora»: el día local, el «mismo día de la semana pasada» y el mes anterior
 * «a mismo día corrido». Con el reloj de la máquina, cada aserción dependería
 * de cuándo corre la suite; con ClockPort (f1-auth §6) los bordes se fijan
 * de una vez y para siempre.
 *
 * La regla de las comparaciones: SIEMPRE a mismo tiempo corrido. Comparar el
 * viernes a las 10am contra el viernes pasado COMPLETO diría «vas 60% abajo»
 * todas las mañanas — el número asustaría sin informar. Lo mismo el mes.
 */
describe("DashboardKpisService (integration)", () => {
  let prisma: PrismaService;
  let service: DashboardKpisService;

  // 2026-03-15T18:00:00Z = 12:00 del 15 de marzo en CDMX (UTC-6, sin DST).
  const AHORA = new Date("2026-03-15T18:00:00.000Z");
  const relojFalso = { now: () => AHORA };

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    service = new DashboardKpisService(prisma, relojFalso);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  interface Escenario {
    tenantId: string;
    warehouseId: string;
    otroAlmacenId: string;
  }

  /** Tenant CDMX con meta de $2,000, dos almacenes, usuario y sesión de caja. */
  async function escenario(goal: string | null = "2000"): Promise<Escenario> {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Kpis ${randomUUID().slice(0, 6)}`,
        timezone: "America/Mexico_City",
        ...(goal !== null && { monthlySalesGoal: goal }),
      },
    });
    return prisma.withTenantContext(tenant.id, async (tx) => {
      const usuario = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: `kpi-${randomUUID()}@example.com`,
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
      const otro = await tx.warehouse.create({
        data: {
          tenantId: tenant.id,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: "Sucursal",
        },
      });
      const producto = await tx.product.create({
        data: { tenantId: tenant.id, sku: `KPI-${randomUUID().slice(0, 8)}`, name: "Genérico" },
      });
      const sesion = await tx.cashboxSession.create({
        data: {
          folio: `TUR-${randomUUID().slice(0, 8)}`,
          tenantId: tenant.id,
          warehouseId: almacen.id,
          openedBy: usuario.id,
        },
      });
      // Guardado para las ventas: la sesión y el usuario son plomería del
      // modelo, no parte de lo que este spec prueba.
      contexto.set(tenant.id, {
        usuarioId: usuario.id,
        sesionId: sesion.id,
        productoId: producto.id,
      });
      return { tenantId: tenant.id, warehouseId: almacen.id, otroAlmacenId: otro.id };
    });
  }

  const contexto = new Map<string, { usuarioId: string; sesionId: string; productoId: string }>();

  interface VentaSemilla {
    creadaEn: string;
    total: number;
    warehouseId: string;
    canceled?: boolean;
    /** Ítems con costo congelado (o sin él) para la utilidad. */
    items?: { lineTotal: number; quantity: number; unitCost: number | null; taxAmount?: number }[];
  }

  async function venta(tenantId: string, semilla: VentaSemilla): Promise<void> {
    const { usuarioId, sesionId, productoId } = contexto.get(tenantId) as {
      usuarioId: string;
      sesionId: string;
      productoId: string;
    };
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.sale.create({
        data: {
          tenantId,
          folio: `K-${randomUUID().slice(0, 12)}`,
          warehouseId: semilla.warehouseId,
          cashboxSessionId: sesionId,
          paymentMethod: "cash",
          status: semilla.canceled ? "canceled" : "completed",
          // El CHECK de coherencia exige canceled_at en las canceladas.
          ...(semilla.canceled && {
            canceledBy: usuarioId,
            canceledAt: new Date(semilla.creadaEn),
          }),
          subtotal: semilla.total,
          discount: 0,
          total: semilla.total,
          createdBy: usuarioId,
          createdAt: new Date(semilla.creadaEn),
          ...(semilla.items && {
            items: {
              create: semilla.items.map((item, i) => ({
                tenantId,
                lineNo: i + 1,
                productId: productoId,
                quantity: item.quantity,
                unitPrice: new Prisma.Decimal(item.lineTotal).dividedBy(item.quantity),
                discount: 0,
                lineTotal: item.lineTotal,
                ...(item.unitCost !== null && { unitCost: item.unitCost }),
                ...(item.taxAmount !== undefined && { taxAmount: item.taxAmount }),
              })),
            },
          }),
        },
      }),
    );
  }

  /** El escenario COMPLETO del 15 de marzo — cada venta prueba un borde. */
  async function escenarioCompleto(): Promise<Escenario> {
    const esc = await escenario();
    const w = esc.warehouseId;
    // HOY (15-mar local): 200 + 100. La de 200 trae costo → utilidad 140.
    await venta(esc.tenantId, {
      creadaEn: "2026-03-15T17:00:00Z",
      total: 200,
      warehouseId: w,
      items: [{ lineTotal: 200, quantity: 2, unitCost: 30 }],
    });
    await venta(esc.tenantId, {
      creadaEn: "2026-03-15T16:00:00Z",
      total: 100,
      warehouseId: w,
      items: [{ lineTotal: 100, quantity: 1, unitCost: null }],
    });
    // La TRAMPA del huso: 05:30Z del 15 es 23:30 del 14 en CDMX. No es «hoy»,
    // pero sí es del mes.
    await venta(esc.tenantId, { creadaEn: "2026-03-15T05:30:00Z", total: 777, warehouseId: w });
    // Mes corriente, días antes.
    await venta(esc.tenantId, { creadaEn: "2026-03-05T18:00:00Z", total: 400, warehouseId: w });
    // Cancelada: no existe para ningún número.
    await venta(esc.tenantId, {
      creadaEn: "2026-03-12T18:00:00Z",
      total: 999,
      warehouseId: w,
      canceled: true,
    });
    // Mismo día de la semana pasada (8-mar): 150 antes del corte de las 12:00
    // local... y 60 DESPUÉS del corte — el corrido también aplica al día.
    await venta(esc.tenantId, { creadaEn: "2026-03-08T15:00:00Z", total: 150, warehouseId: w });
    await venta(esc.tenantId, { creadaEn: "2026-03-08T20:00:00Z", total: 60, warehouseId: w });
    // Mes anterior: 100 dentro del corrido (10-feb) y 500 después (20-feb).
    // La de febrero trae costo: utilidad previa 100 − 60 = 40, la base de la
    // delta de utilidad.
    await venta(esc.tenantId, {
      creadaEn: "2026-02-10T18:00:00Z",
      total: 100,
      warehouseId: w,
      items: [{ lineTotal: 100, quantity: 1, unitCost: 60 }],
    });
    // La del 20-feb también trae costo: si alguien comparara contra el mes
    // COMPLETO en vez del corrido, esta utilidad de 400 lo delataría.
    await venta(esc.tenantId, {
      creadaEn: "2026-02-20T18:00:00Z",
      total: 500,
      warehouseId: w,
      items: [{ lineTotal: 500, quantity: 1, unitCost: 100 }],
    });
    return esc;
  }

  it("hoy: suma el día LOCAL, cuenta tickets y compara contra el mismo día corrido de la semana pasada", async () => {
    const esc = await escenarioCompleto();

    const kpis = await service.kpis(
      { tenantId: esc.tenantId } as never,
      { warehouseIds: "all" } as never,
    );

    // 200 + 100. La de 23:30 local del día 14 queda fuera aunque su instante
    // UTC diga día 15 — la trampa exacta que este KPI existe para no pisar.
    expect(kpis.today.total).toBe("300");
    expect(kpis.today.tickets).toBe(2);
    expect(kpis.today.averageTicket).toBe("150");
    // vs 150 (la de las 20:00Z del día 8 cae DESPUÉS del corte de las 12:00
    // locales y no compite): (300-150)/150 = +100%.
    expect(kpis.today.deltaVsLastWeekPct).toBe(100);
  });

  it("mes: a mismo día corrido contra el anterior, con la meta y su avance", async () => {
    const esc = await escenarioCompleto();

    const kpis = await service.kpis(
      { tenantId: esc.tenantId } as never,
      { warehouseIds: "all" } as never,
    );

    // 200+100+777+400+150+60 = 1687 (la cancelada de 999 no existe; las del
    // día 8 también son de marzo — la semana pasada no vive en otro mes).
    expect(kpis.month.total).toBe("1687");
    // Febrero corrido hasta el 15 a las 12:00: solo la de 100. (1687-100)/100.
    expect(kpis.month.deltaVsPrevMonthPct).toBe(1587);
    expect(kpis.month.goal).toBe("2000");
    expect(kpis.month.goalPct).toBe(84.4);
  });

  it("utilidad del mes: SOLO las líneas con costo congelado suman", async () => {
    const esc = await escenarioCompleto();

    const kpis = await service.kpis(
      { tenantId: esc.tenantId } as never,
      { warehouseIds: "all" } as never,
    );

    // Solo la línea de 200 con costo 30×2: 200 − 60 = 140. La línea sin
    // snapshot no INVENTA una utilidad del 100%.
    expect(kpis.profit.month).toBe("140");
    // Y la delta contra febrero corrido (utilidad 40): (140−40)/40 = +250%.
    // La MISMA ley del corrido que ventas — la utilidad no compara un mes
    // parcial contra uno completo.
    expect(kpis.profit.deltaVsPrevMonthPct).toBe(250);
  });

  /** Un gasto con su día del negocio; `canceled` lo deja anulado. */
  async function gasto(
    tenantId: string,
    warehouseId: string,
    dia: string,
    total: number,
    canceled = false,
  ): Promise<void> {
    const { usuarioId } = contexto.get(tenantId) as { usuarioId: string };
    await prisma.withTenantContext(tenantId, async (tx) => {
      const categoria =
        (await tx.expenseCategory.findFirst({ where: { tenantId, code: "rent" } })) ??
        (await tx.expenseCategory.create({ data: { tenantId, code: "rent", name: "Renta" } }));
      await tx.expense.create({
        data: {
          tenantId,
          folio: `G-${randomUUID().slice(0, 12)}`,
          warehouseId,
          expenseDate: new Date(dia),
          categoryId: categoria.id,
          description: "Gasto",
          amount: total,
          total,
          taxMode: "included",
          createdBy: usuarioId,
          ...(canceled && {
            status: "canceled",
            canceledAt: new Date(),
            canceledBy: usuarioId,
            cancelReason: "x",
          }),
        },
      });
    });
  }

  /** El mismo servicio con el reloj en otro instante (el borde de los días cerrados). */
  const servicioEn = (iso: string) =>
    new DashboardKpisService(prisma, { now: () => new Date(iso) });

  /** Una venta de `total` a las 12:00 de CDMX de cada día de marzo, de `desde` a `hasta`. */
  async function ventasDiarias(
    esc: Escenario,
    desde: number,
    hasta: number,
    total: number,
    warehouseId = esc.warehouseId,
  ): Promise<void> {
    for (let dia = desde; dia <= hasta; dia++) {
      await venta(esc.tenantId, {
        creadaEn: `2026-03-${String(dia).padStart(2, "0")}T18:00:00Z`,
        total,
        warehouseId,
      });
    }
  }

  const todo = { warehouseIds: "all" } as never;

  /**
   * F9-EXP-11 — la utilidad NETA: bruta − gastos ACTIVOS del mes por DÍA del
   * negocio y en el alcance. Sin bruta no hay neta, aunque haya gastos.
   */
  describe("utilidad neta (F9-EXP-11)", () => {
    it("resta los gastos activos del mes corriente, por día del negocio; un anulado no resta", async () => {
      const esc = await escenarioCompleto();
      // Día 1 del mes: cuenta, aunque a las 20:00 de CDMX ya sea día 2 en UTC.
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-01", 30);
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-15", 10);
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-14", 999, true);
      // Del mes anterior dentro del corrido (10-feb): la base de la delta neta.
      await gasto(esc.tenantId, esc.warehouseId, "2026-02-10", 20);
      // Fuera del corrido del mes anterior (20-feb): no cuenta.
      await gasto(esc.tenantId, esc.warehouseId, "2026-02-20", 500);

      const kpis = await service.kpis(
        { tenantId: esc.tenantId } as never,
        { warehouseIds: "all" } as never,
      );
      // Bruta 140 − (30 + 10) = 100; la anulada no existe.
      expect(kpis.profit.month).toBe("140");
      expect(kpis.profit.netMonth).toBe("100");
      // Neta pasada: 40 − 20 = 20 → (100 − 20) / 20 = +400 %.
      expect(kpis.profit.netDeltaVsPrevMonthPct).toBe(400);
    });

    it("sin costo congelado la neta es null aunque haya gastos", async () => {
      const esc = await escenario();
      await venta(esc.tenantId, {
        creadaEn: "2026-03-10T18:00:00Z",
        total: 100,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 100, quantity: 1, unitCost: null }],
      });
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-10", 30);
      const kpis = await service.kpis(
        { tenantId: esc.tenantId } as never,
        { warehouseIds: "all" } as never,
      );
      expect(kpis.profit.month).toBeNull();
      expect(kpis.profit.netMonth).toBeNull();
    });

    it("el alcance acota: mirando Central no se restan los gastos de la Sucursal", async () => {
      const esc = await escenarioCompleto();
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-15", 10);
      await gasto(esc.tenantId, esc.otroAlmacenId, "2026-03-15", 1000);
      const kpis = await service.kpis(
        { tenantId: esc.tenantId } as never,
        { warehouseIds: [esc.warehouseId] } as never,
      );
      expect(kpis.profit.netMonth).toBe("130");
    });
  });

  it("F4-TAX-20: la utilidad resta el impuesto de la línea; el bruto del mes no lo toca", async () => {
    const esc = await escenario();
    // Una venta en excluido: 100 neto + 12 de impuesto, costo 40…
    await venta(esc.tenantId, {
      creadaEn: "2026-03-10T18:00:00Z",
      total: 112,
      warehouseId: esc.warehouseId,
      items: [{ lineTotal: 112, quantity: 1, unitCost: 40, taxAmount: 12 }],
    });
    // …y una en incluido: 116 con 16 adentro, costo 50.
    await venta(esc.tenantId, {
      creadaEn: "2026-03-11T18:00:00Z",
      total: 116,
      warehouseId: esc.warehouseId,
      items: [{ lineTotal: 116, quantity: 1, unitCost: 50, taxAmount: 16 }],
    });

    const kpis = await service.kpis(
      { tenantId: esc.tenantId } as never,
      { warehouseIds: "all" } as never,
    );

    // El KPI de ventas es lo que entró a la caja (decisión de Carlos,
    // 2026-09-06); la utilidad, sobre la base: (112−12−40) + (116−16−50).
    expect(kpis.month.total).toBe("228");
    expect(kpis.profit.month).toBe("110");
  });

  it("el alcance por almacén acota TODOS los números", async () => {
    const esc = await escenarioCompleto();
    // Venta gorda de HOY en el otro almacén: quien no lo tiene, no la ve.
    await venta(esc.tenantId, {
      creadaEn: "2026-03-15T16:30:00Z",
      total: 5000,
      warehouseId: esc.otroAlmacenId,
    });

    const acotado = await service.kpis(
      { tenantId: esc.tenantId } as never,
      { warehouseIds: [esc.warehouseId] } as never,
    );
    const completo = await service.kpis(
      { tenantId: esc.tenantId } as never,
      { warehouseIds: "all" } as never,
    );

    expect(acotado.today.total).toBe("300");
    expect(completo.today.total).toBe("5300");
  });

  it("un negocio sin ventas ni meta responde ceros y nulls honestos, jamás NaN", async () => {
    const esc = await escenario(null);

    const kpis = await service.kpis(
      { tenantId: esc.tenantId } as never,
      { warehouseIds: "all" } as never,
    );

    expect(kpis.today.total).toBe("0");
    expect(kpis.today.tickets).toBe(0);
    // Sin tickets no hay promedio; sin semana pasada no hay delta; sin
    // snapshot no hay utilidad; sin meta no hay avance. NULL dice «aún no
    // sé» — un 0 diría «te fue pésimo», que es otra cosa.
    expect(kpis.today.averageTicket).toBeNull();
    expect(kpis.today.deltaVsLastWeekPct).toBeNull();
    expect(kpis.month.deltaVsPrevMonthPct).toBeNull();
    expect(kpis.month.goal).toBeNull();
    expect(kpis.month.goalPct).toBeNull();
    expect(kpis.profit.month).toBeNull();
    expect(kpis.profit.deltaVsPrevMonthPct).toBeNull();
    // F10-KPI-05/06: sin utilidad no hay margen; sin ninguna venta no hay de
    // dónde estimar el cierre; sin meta no hay ritmo; sin gastos no hay avance.
    expect(kpis.profit.marginPct).toBeNull();
    expect(kpis.month.projected).toBeNull();
    expect(kpis.month.requiredDaily).toBeNull();
    expect(kpis.profit.breakEven).toEqual({
      expenses: "0.00",
      coveredPct: null,
      coveredOnDay: null,
      remainingSales: null,
    });
  });

  /**
   * F10-KPI-05 — el margen del mes y a dónde vas. El cierre estimado usa solo
   * días CERRADOS (no se mueve durante el día) y calla hasta tener tres; lo
   * que falta para la meta se reparte entre los días que quedan, contando hoy.
   */
  describe("margen, cierre estimado y ritmo para la meta (F10-KPI-05)", () => {
    it("14 días cerrados proyectan los 31: lo vendido más su promedio por los días que faltan, contando hoy", async () => {
      const esc = await escenario();
      await ventasDiarias(esc, 1, 14, 100);
      // Hoy también se vendió; la estimación no lo usa.
      await venta(esc.tenantId, {
        creadaEn: "2026-03-15T17:00:00Z",
        total: 300,
        warehouseId: esc.warehouseId,
      });

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      // 1,400 en 14 días cerrados = 100 al día, por los 17 que faltan (15 al 31).
      expect(kpis.month.projected).toBe("3100.00");
    });

    it("la venta de hoy no mueve la estimación", async () => {
      const esc = await escenario();
      await ventasDiarias(esc, 1, 14, 100);
      const antes = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      await venta(esc.tenantId, {
        creadaEn: "2026-03-15T17:30:00Z",
        total: 5000,
        warehouseId: esc.warehouseId,
      });
      const despues = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(antes.month.projected).toBe("3100.00");
      expect(despues.month.projected).toBe("3100.00");
      // Lo vendido del mes sí se movió: la venta existe, solo no estima.
      expect(despues.month.total).toBe("6400");
    });

    it("calla hasta tener tres días cerrados: el día 2 no hay estimación", async () => {
      const esc = await escenario();
      // El negocio ya vendía en febrero: sus días cerrados empiezan el 1.
      await venta(esc.tenantId, {
        creadaEn: "2026-02-20T18:00:00Z",
        total: 500,
        warehouseId: esc.warehouseId,
      });
      await ventasDiarias(esc, 1, 3, 100);
      const usuario = { tenantId: esc.tenantId } as never;

      const dia2 = await servicioEn("2026-03-02T18:00:00Z").kpis(usuario, todo);
      const dia3 = await servicioEn("2026-03-03T18:00:00Z").kpis(usuario, todo);
      const dia4 = await servicioEn("2026-03-04T18:00:00Z").kpis(usuario, todo);

      expect(dia2.month.projected).toBeNull();
      expect(dia3.month.projected).toBeNull();
      // Tres días cerrados (1, 2 y 3): 300 = 100 al día, por los 28 que faltan.
      expect(dia4.month.projected).toBe("3100.00");
    });

    it("un negocio que empezó el día 10 promedia desde su primera venta, no desde el 1", async () => {
      const esc = await escenario();
      // Una cancelada del día 5 no es su primera venta: no existe para el panel.
      await venta(esc.tenantId, {
        creadaEn: "2026-03-05T18:00:00Z",
        total: 999,
        warehouseId: esc.warehouseId,
        canceled: true,
      });
      await ventasDiarias(esc, 10, 14, 200);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      // Cinco días cerrados (10 al 14): 1,000 = 200 al día, por 17. Contando
      // desde el 1 diría 2,214.29: castigaría los días en que no existía.
      expect(kpis.month.projected).toBe("4400.00");
    });

    it("con el alcance, la primera venta es la de las sucursales que ves", async () => {
      const esc = await escenario();
      // La Sucursal ya vendía el día 1; Central abrió el 10.
      await venta(esc.tenantId, {
        creadaEn: "2026-03-01T18:00:00Z",
        total: 50,
        warehouseId: esc.otroAlmacenId,
      });
      await ventasDiarias(esc, 10, 14, 200);

      const central = await service.kpis(
        { tenantId: esc.tenantId } as never,
        { warehouseIds: [esc.warehouseId] } as never,
      );
      const todas = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(central.month.projected).toBe("4400.00");
      // Las dos juntas: 1,050 en 14 días cerrados = 75 al día, por 17.
      expect(todas.month.projected).toBe("2325.00");
    });

    it("lo que falta para la meta se reparte entre los días que quedan, contando hoy", async () => {
      const esc = await escenarioCompleto();

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      // Meta 2,000 − 1,687 vendidos = 313, entre 17 días (del 15 al 31).
      expect(kpis.month.requiredDaily).toBe("18.41");
    });

    it("con la meta alcanzada, lo que falta al día es «0.00»", async () => {
      const esc = await escenarioCompleto();
      await prisma.tenant.update({
        where: { id: esc.tenantId },
        data: { monthlySalesGoal: "1000" },
      });

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.month.goalPct).toBe(168.7);
      expect(kpis.month.requiredDaily).toBe("0.00");
    });

    it("sin meta no hay ritmo para la meta: null, no 0", async () => {
      const esc = await escenario(null);
      await ventasDiarias(esc, 1, 14, 100);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.month.requiredDaily).toBeNull();
      // El cierre estimado no depende de la meta.
      expect(kpis.month.projected).toBe("3100.00");
    });

    it("el margen ignora las líneas sin costo", async () => {
      const esc = await escenarioCompleto();

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      // 140 de utilidad sobre los 200 de la línea con costo. La de 100 sin
      // costo no entra al divisor: con ella diría 46.7%.
      expect(kpis.profit.marginPct).toBe(70);
    });

    it("el margen va sobre el precio sin impuesto, como la utilidad", async () => {
      const esc = await escenario();
      await venta(esc.tenantId, {
        creadaEn: "2026-03-10T18:00:00Z",
        total: 112,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 112, quantity: 1, unitCost: 40, taxAmount: 12 }],
      });
      await venta(esc.tenantId, {
        creadaEn: "2026-03-11T18:00:00Z",
        total: 116,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 116, quantity: 1, unitCost: 50, taxAmount: 16 }],
      });

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      // 110 de utilidad sobre 200 de base; sobre lo cobrado (228) diría 48.2%.
      expect(kpis.profit.marginPct).toBe(55);
    });
  });

  /**
   * F10-KPI-06 — el punto de equilibrio. A medio mes la neta sale negativa
   * por construcción (la renta entra completa con su fecha y las ventas se
   * acumulan día a día); el panel lo dice como avance: cuánto de los gastos
   * ya cubrió la utilidad, desde qué día, o cuánto falta vender.
   */
  describe("punto de equilibrio (F10-KPI-06)", () => {
    /** Una venta de una línea que deja exactamente `utilidad` (precio = 2 × costo). */
    const conUtilidad = (esc: Escenario, creadaEn: string, utilidad: number) =>
      venta(esc.tenantId, {
        creadaEn,
        total: utilidad * 2,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: utilidad * 2, quantity: 1, unitCost: utilidad }],
      });

    it("el caso de la captura: 6,782.19 de utilidad contra 9,740.00 de gastos es 69.6% cubierto", async () => {
      const esc = await escenario();
      await venta(esc.tenantId, {
        creadaEn: "2026-03-10T18:00:00Z",
        total: 10000,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 10000, quantity: 1, unitCost: 3217.81 }],
      });
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-01", 9740);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.profit.month).toBe("6782.19");
      expect(kpis.profit.netMonth).toBe("-2957.81");
      expect(kpis.profit.breakEven).toEqual({
        expenses: "9740.00",
        coveredPct: 69.6,
        coveredOnDay: null,
        // Faltan 2,957.81 de utilidad y cada peso cobrado dejó 0.678219.
        remainingSales: "4361.14",
      });
    });

    it("el día en que se cruza: el primer día local en que la utilidad acumulada alcanzó los gastos", async () => {
      const esc = await escenario();
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-01", 1000);
      await conUtilidad(esc, "2026-03-03T18:00:00Z", 400);
      await conUtilidad(esc, "2026-03-07T18:00:00Z", 400);
      // 23:30 del día 9 en CDMX (05:30 del 10 en UTC): con esta se cruza, y es del 9.
      await conUtilidad(esc, "2026-03-10T05:30:00Z", 300);
      await conUtilidad(esc, "2026-03-12T18:00:00Z", 200);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.profit.breakEven).toEqual({
        expenses: "1000.00",
        coveredPct: 130,
        coveredOnDay: 9,
        remainingSales: null,
      });
    });

    it("si una pérdida los vuelve a destapar, «cubiertos desde» es el día del nuevo cruce", async () => {
      const esc = await escenario();
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-01", 1000);
      await conUtilidad(esc, "2026-03-03T18:00:00Z", 1100);
      // El día 6 se vendió por debajo del costo: la acumulada baja a 800.
      await venta(esc.tenantId, {
        creadaEn: "2026-03-06T18:00:00Z",
        total: 100,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 100, quantity: 1, unitCost: 400 }],
      });
      await conUtilidad(esc, "2026-03-11T18:00:00Z", 300);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.profit.breakEven.coveredPct).toBe(110);
      expect(kpis.profit.breakEven.coveredOnDay).toBe(11);
    });

    it("sin gastos no hay avance que medir: null, no 100%", async () => {
      const esc = await escenarioCompleto();

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.profit.month).toBe("140");
      expect(kpis.profit.breakEven).toEqual({
        expenses: "0.00",
        coveredPct: null,
        coveredOnDay: null,
        remainingSales: null,
      });
    });

    it("un gasto anulado no cuenta", async () => {
      const esc = await escenarioCompleto();
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-02", 500);
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-03", 999, true);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.profit.breakEven.expenses).toBe("500.00");
      // 140 de utilidad ÷ 500 de gastos.
      expect(kpis.profit.breakEven.coveredPct).toBe(28);
    });

    it("el alcance acota la utilidad y los gastos: mirando Central no cuentan los de la Sucursal", async () => {
      const esc = await escenarioCompleto();
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-02", 100);
      await gasto(esc.tenantId, esc.otroAlmacenId, "2026-03-02", 5000);
      // La Sucursal dejó 1,000 el día 4: si se colara, Central «cubriría» ese día.
      await venta(esc.tenantId, {
        creadaEn: "2026-03-04T18:00:00Z",
        total: 2000,
        warehouseId: esc.otroAlmacenId,
        items: [{ lineTotal: 2000, quantity: 1, unitCost: 1000 }],
      });

      const central = await service.kpis(
        { tenantId: esc.tenantId } as never,
        { warehouseIds: [esc.warehouseId] } as never,
      );
      const todas = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      // Central: sus 140 de utilidad (de hoy) contra sus 100 de gastos.
      expect(central.profit.breakEven).toEqual({
        expenses: "100.00",
        coveredPct: 140,
        coveredOnDay: 15,
        remainingSales: null,
      });
      // Las dos juntas: 1,140 ÷ 5,100.
      expect(todas.profit.breakEven.expenses).toBe("5100.00");
      expect(todas.profit.breakEven.coveredPct).toBe(22.4);
      expect(todas.profit.breakEven.coveredOnDay).toBeNull();
    });

    it("lo que falta vender sale de lo que dejó cada peso cobrado en los últimos 30 días, solo con costo", async () => {
      const esc = await escenario();
      // Este mes: 1,160 cobrados (160 de impuesto) con 500 de costo: deja 500.
      await venta(esc.tenantId, {
        creadaEn: "2026-03-10T18:00:00Z",
        total: 1160,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 1160, quantity: 1, unitCost: 500, taxAmount: 160 }],
      });
      // Dentro de los 30 días (20 de febrero): 1,000 cobrados que dejaron 300.
      await venta(esc.tenantId, {
        creadaEn: "2026-02-20T18:00:00Z",
        total: 1000,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 1000, quantity: 1, unitCost: 700 }],
      });
      // Fuera de los 30 días (5 de febrero): no entra.
      await venta(esc.tenantId, {
        creadaEn: "2026-02-05T18:00:00Z",
        total: 1000,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 1000, quantity: 1, unitCost: 0 }],
      });
      // Sin costo: no dice cuánto deja un peso; no entra.
      await venta(esc.tenantId, {
        creadaEn: "2026-03-11T18:00:00Z",
        total: 5000,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 5000, quantity: 1, unitCost: null }],
      });
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-01", 2000);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.profit.month).toBe("500");
      // Faltan 1,500 de utilidad; cada peso cobrado dejó 800 ÷ 2,160.
      expect(kpis.profit.breakEven.remainingSales).toBe("4050.00");
    });

    it("si cada peso cobrado no deja utilidad, no hay con qué estimar lo que falta", async () => {
      const esc = await escenario();
      await venta(esc.tenantId, {
        creadaEn: "2026-03-10T18:00:00Z",
        total: 100,
        warehouseId: esc.warehouseId,
        items: [{ lineTotal: 100, quantity: 1, unitCost: 150 }],
      });
      await gasto(esc.tenantId, esc.warehouseId, "2026-03-01", 100);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.profit.breakEven).toEqual({
        expenses: "100.00",
        coveredPct: -50,
        coveredOnDay: null,
        remainingSales: null,
      });
    });
  });

  /**
   * F10-KPI-16 — lo que pide atención: los gastos por pagar con fecha de
   * vencimiento y los turnos que cerraron con faltante desde ayer. Viaja en
   * `kpis` porque los avisos del panel se componen de lo que ya se cargó.
   */
  describe("lo que pide atención (F10-KPI-16)", () => {
    /** Un gasto con vencimiento; `pagado` y `anulado` dicen su estado. */
    async function porPagar(
      esc: Escenario,
      datos: {
        vence: string | null;
        total: number;
        pagado?: boolean;
        anulado?: boolean;
        warehouseId?: string;
        // El día del gasto no acota: uno de enero que vence esta semana cuenta.
        fecha?: string;
      },
    ): Promise<void> {
      const { usuarioId } = contexto.get(esc.tenantId) as { usuarioId: string };
      await prisma.withTenantContext(esc.tenantId, async (tx) => {
        const categoria =
          (await tx.expenseCategory.findFirst({
            where: { tenantId: esc.tenantId, code: "rent" },
          })) ??
          (await tx.expenseCategory.create({
            data: { tenantId: esc.tenantId, code: "rent", name: "Renta" },
          }));
        await tx.expense.create({
          data: {
            tenantId: esc.tenantId,
            folio: `G-${randomUUID().slice(0, 12)}`,
            warehouseId: datos.warehouseId ?? esc.warehouseId,
            expenseDate: new Date(datos.fecha ?? "2026-03-01"),
            categoryId: categoria.id,
            description: "Gasto por pagar",
            amount: datos.total,
            total: datos.total,
            taxMode: "included",
            createdBy: usuarioId,
            ...(datos.vence !== null && { dueDate: new Date(datos.vence) }),
            // Los CHECK de coherencia: pagado trae método y fecha; anulado, quién, cuándo y por qué.
            ...(datos.pagado && {
              paymentStatus: "paid",
              paymentMethod: "cash",
              paidAt: new Date("2026-03-10T18:00:00Z"),
            }),
            ...(datos.anulado && {
              status: "canceled",
              canceledAt: new Date("2026-03-10T18:00:00Z"),
              canceledBy: usuarioId,
              cancelReason: "duplicado",
            }),
          },
        });
      });
    }

    /** Un turno CERRADO en `cerradoEn` con su diferencia (declarado − calculado). */
    async function turnoCerrado(
      esc: Escenario,
      cerradoEn: string,
      diferencia: string | null,
      warehouseId = esc.warehouseId,
    ): Promise<void> {
      const { usuarioId } = contexto.get(esc.tenantId) as { usuarioId: string };
      const cierre = new Date(cerradoEn);
      await prisma.withTenantContext(esc.tenantId, (tx) =>
        tx.cashboxSession.create({
          data: {
            tenantId: esc.tenantId,
            folio: `TUR-${randomUUID().slice(0, 8)}`,
            warehouseId,
            status: "closed",
            openedBy: usuarioId,
            openedAt: new Date(cierre.getTime() - 8 * 60 * 60 * 1000),
            closedBy: usuarioId,
            closedAt: cierre,
            cashDifference: diferencia,
          },
        }),
      );
    }

    it("un gasto que vence hoy es «por vencer», no «vencido»; los de antes de hoy sí son vencidos", async () => {
      const esc = await escenario();
      await porPagar(esc, { vence: "2026-03-15", total: 100 });
      await porPagar(esc, { vence: "2026-03-14", total: 200 });
      await porPagar(esc, { vence: "2026-02-28", total: 50.5, fecha: "2026-01-20" });

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.attention.payables).toEqual({
        overdueCount: 2,
        overdueAmount: "250.50",
        dueSoonCount: 1,
        dueSoonAmount: "100.00",
      });
    });

    it("«por vencer» llega hasta siete días después de hoy, contándolos por fecha local", async () => {
      const esc = await escenario();
      await porPagar(esc, { vence: "2026-03-22", total: 30, fecha: "2026-01-20" });
      await porPagar(esc, { vence: "2026-03-23", total: 999 });

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.attention.payables).toEqual({
        overdueCount: 0,
        overdueAmount: "0.00",
        dueSoonCount: 1,
        dueSoonAmount: "30.00",
      });
    });

    it("uno pagado o anulado no cuenta", async () => {
      const esc = await escenario();
      await porPagar(esc, { vence: "2026-03-10", total: 70 });
      await porPagar(esc, { vence: "2026-03-10", total: 500, pagado: true });
      await porPagar(esc, { vence: "2026-03-16", total: 600, pagado: true });
      await porPagar(esc, { vence: "2026-03-10", total: 700, anulado: true });
      await porPagar(esc, { vence: "2026-03-16", total: 800, anulado: true });

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.attention.payables).toEqual({
        overdueCount: 1,
        overdueAmount: "70.00",
        dueSoonCount: 0,
        dueSoonAmount: "0.00",
      });
    });

    it("uno sin fecha de vencimiento no cuenta: no hay de qué avisar", async () => {
      const esc = await escenario();
      await porPagar(esc, { vence: null, total: 1000 });

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.attention.payables).toEqual({
        overdueCount: 0,
        overdueAmount: "0.00",
        dueSoonCount: 0,
        dueSoonAmount: "0.00",
      });
    });

    it("los faltantes son de los turnos cerrados desde el inicio de ayer, hora local: uno de anteayer no cuenta", async () => {
      const esc = await escenario();
      // 00:30 del 14 en CDMX: ayer, el primer minuto que cuenta.
      await turnoCerrado(esc, "2026-03-14T06:30:00Z", "-150.00");
      await turnoCerrado(esc, "2026-03-15T17:00:00Z", "-50.25");
      // 23:30 del 13 en CDMX (en UTC ya es 14): anteayer, no cuenta.
      await turnoCerrado(esc, "2026-03-14T05:30:00Z", "-999.00");

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      // El faltante se dice en positivo, como en «Control».
      expect(kpis.attention.shiftShortages).toEqual({
        count: 2,
        amount: "200.25",
        range: { from: "2026-03-14", to: "2026-03-15" },
      });
    });

    it("un sobrante no cuenta, ni compensa un faltante", async () => {
      const esc = await escenario();
      await turnoCerrado(esc, "2026-03-15T01:00:00Z", "-100.00");
      await turnoCerrado(esc, "2026-03-15T02:00:00Z", "300.00");
      await turnoCerrado(esc, "2026-03-15T03:00:00Z", "0.00");
      // Un cierre sin arqueo: no se sabe si faltó.
      await turnoCerrado(esc, "2026-03-15T04:00:00Z", null);

      const kpis = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(kpis.attention.shiftShortages.count).toBe(1);
      expect(kpis.attention.shiftShortages.amount).toBe("100.00");
    });

    it("el alcance por sucursal acota los gastos y los faltantes", async () => {
      const esc = await escenario();
      await porPagar(esc, { vence: "2026-03-10", total: 40 });
      await porPagar(esc, { vence: "2026-03-10", total: 4000, warehouseId: esc.otroAlmacenId });
      await porPagar(esc, { vence: "2026-03-18", total: 5000, warehouseId: esc.otroAlmacenId });
      await turnoCerrado(esc, "2026-03-15T17:00:00Z", "-10.00");
      await turnoCerrado(esc, "2026-03-15T17:00:00Z", "-900.00", esc.otroAlmacenId);

      const central = await service.kpis(
        { tenantId: esc.tenantId } as never,
        { warehouseIds: [esc.warehouseId] } as never,
      );
      const todas = await service.kpis({ tenantId: esc.tenantId } as never, todo);

      expect(central.attention.payables).toEqual({
        overdueCount: 1,
        overdueAmount: "40.00",
        dueSoonCount: 0,
        dueSoonAmount: "0.00",
      });
      expect(central.attention.shiftShortages).toMatchObject({ count: 1, amount: "10.00" });
      expect(todas.attention.payables).toEqual({
        overdueCount: 2,
        overdueAmount: "4040.00",
        dueSoonCount: 1,
        dueSoonAmount: "5000.00",
      });
      expect(todas.attention.shiftShortages).toMatchObject({ count: 2, amount: "910.00" });
    });
  });

  /**
   * El panel abría once transacciones a la vez por carga (una por consulta)
   * contra un pool de diez conexiones: un e2e falló con «Unable to start a
   * transaction in the given time». Ahora todas las consultas de `kpis()` van
   * dentro de UNA, como en «Control» (F10-KPI-14).
   */
  it("hace todas sus consultas dentro de UNA sola transacción", async () => {
    const esc = await escenarioCompleto();
    await gasto(esc.tenantId, esc.warehouseId, "2026-03-02", 500);
    let transacciones = 0;
    // Cualquier cosa del cliente que no sea `withTenantContext` revienta:
    // así ninguna consulta se escapa de la transacción, tampoco la del negocio.
    const soloUnaTransaccion = new Proxy(prisma, {
      get(objetivo, propiedad) {
        if (propiedad === "withTenantContext") {
          return (...args: Parameters<PrismaService["withTenantContext"]>) => {
            transacciones += 1;
            return objetivo.withTenantContext(...args);
          };
        }
        throw new Error(`consulta fuera de la transacción: ${String(propiedad)}`);
      },
    });
    const contado = new DashboardKpisService(soloUnaTransaccion, relojFalso);

    const kpis = await contado.kpis({ tenantId: esc.tenantId } as never, todo);

    expect(transacciones).toBe(1);
    // Y los números son los de siempre: la meta del negocio se leyó adentro.
    expect(kpis.month.total).toBe("1687");
    expect(kpis.month.goalPct).toBe(84.4);
    expect(kpis.profit.breakEven.expenses).toBe("500.00");
  });
});
