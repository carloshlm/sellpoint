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
    items?: { lineTotal: number; quantity: number; unitCost: number | null }[];
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
  });
});
