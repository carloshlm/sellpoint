import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { DashboardControlService } from "./dashboard-control.service";

/**
 * F10-KPI-14 — «Control»: los faltantes de caja, los descuentos y las
 * cancelaciones del periodo (integration, Postgres real + reloj falso:
 * 15-mar-2026 12:00 CDMX, el mismo instante del resto del panel).
 *
 * Se guardan desde el primer día y nadie los suma: es lo primero que un dueño
 * pregunta cuando sospecha. Por eso cada borde tiene su dato sembrado:
 *
 * - En la semana (lunes 9 a hoy) solo cierran un faltante de 200 y un sobrante
 *   de 200, más uno que cuadró: juntos NO dan cero.
 * - Un turno ABIERTO con una diferencia que no debería existir no cuenta.
 * - Un turno que cerró el 28 de febrero a las 23:00 (ya 1 de marzo en UTC) es
 *   de febrero: la zona del negocio manda.
 * - Una venta cancelada que llevaba descuento no suma a los descuentos.
 * - Una venta de febrero cancelada el 1 de marzo a las 00:30 cuenta en marzo;
 *   una cancelada el 28 de febrero a las 23:30 (1 de marzo en UTC), en febrero.
 * - La sucursal Norte tiene lo suyo, para probar el alcance.
 */
describe("DashboardControlService — Control del panel (integration)", () => {
  let prisma: PrismaService;
  let service: DashboardControlService;
  const AHORA = new Date("2026-03-15T18:00:00.000Z");
  const relojFalso = { now: () => AHORA };

  let tenantId: string;
  let anaId: string;
  let centralId: string;
  let norteId: string;
  const TODO = { warehouseIds: "all" as const };
  const usuario = (): AuthUser => ({
    userId: anaId,
    tenantId,
    permissions: ["reports:read"],
    locale: "es",
  });

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    service = new DashboardControlService(prisma, relojFalso);

    const tenant = await prisma.tenant.create({
      data: { name: `Control ${randomUUID().slice(0, 6)}`, timezone: "America/Mexico_City" },
    });
    tenantId = tenant.id;
    await prisma.withTenantContext(tenantId, async (tx) => {
      const ana = await tx.user.create({
        data: {
          tenantId,
          email: `ana-${randomUUID()}@example.com`,
          firstName: "Ana",
          lastName: "Pérez",
        },
      });
      anaId = ana.id;
      const almacen = (name: string) =>
        tx.warehouse.create({
          data: { tenantId, code: `WH-${Math.random().toString(36).slice(2, 10)}`, name },
        });
      const central = await almacen("Central");
      const norte = await almacen("Norte");
      centralId = central.id;
      norteId = norte.id;

      const cerrado = (warehouseId: string, closedAt: string, cashDifference: string | null) => ({
        tenantId,
        folio: `K14-${randomUUID().slice(0, 8)}`,
        warehouseId,
        openedBy: ana.id,
        status: "closed" as const,
        closedBy: ana.id,
        openedAt: new Date(new Date(closedAt).getTime() - 8 * 60 * 60 * 1000),
        closedAt: new Date(closedAt),
        calculatedCash: cashDifference === null ? null : "1000.00",
        declaredCash: cashDifference === null ? null : "1000.00",
        cashDifference,
      });
      await tx.cashboxSession.createMany({
        data: [
          // La semana: un faltante de 200, un sobrante de 200 y uno que cuadró.
          cerrado(central.id, "2026-03-10T23:00:00.000Z", "-200.00"),
          cerrado(central.id, "2026-03-11T23:00:00.000Z", "200.00"),
          cerrado(central.id, "2026-03-12T23:00:00.000Z", "0.00"),
          // El resto del mes.
          cerrado(central.id, "2026-03-03T23:00:00.000Z", "-50.50"),
          // Un cierre sin arqueo: es un turno cerrado, pero no faltó ni sobró.
          cerrado(central.id, "2026-03-05T23:00:00.000Z", null),
          cerrado(norte.id, "2026-03-04T23:00:00.000Z", "-30.00"),
          // 28 de febrero a las 23:00 en CDMX (en UTC ya es 1 de marzo).
          cerrado(central.id, "2026-03-01T05:00:00.000Z", "-77.00"),
        ],
      });

      // Un turno ABIERTO con una diferencia que no debería existir (una fecha
      // de cierre no se puede: lo impide el CHECK `cashbox_sessions_closed_coherent`).
      // Las ventas sembradas cuelgan de él: solo puede haber uno abierto por persona.
      const turno = await tx.cashboxSession.create({
        data: {
          tenantId,
          folio: `K14-${randomUUID().slice(0, 8)}`,
          warehouseId: central.id,
          openedBy: ana.id,
          openedAt: new Date("2026-02-01T15:00:00.000Z"),
          cashDifference: "-999.00",
        },
      });
      const venta = (
        warehouseId: string,
        createdAt: string,
        total: string,
        discount: string,
        cancelada?: string,
      ) => ({
        tenantId,
        folio: `K14-${randomUUID().slice(0, 12)}`,
        warehouseId,
        cashboxSessionId: turno.id,
        createdBy: ana.id,
        paymentMethod: "card" as const,
        subtotal: (Number(total) + Number(discount)).toFixed(2),
        discount,
        total,
        createdAt: new Date(createdAt),
        ...(cancelada === undefined
          ? { status: "completed" as const }
          : {
              status: "canceled" as const,
              canceledBy: ana.id,
              canceledAt: new Date(cancelada),
              cancelReason: "Se equivocó de producto",
            }),
      });
      await tx.sale.createMany({
        data: [
          // Central, marzo: una con descuento y una sin él.
          venta(central.id, "2026-03-05T17:00:00.000Z", "1000.00", "100.00"),
          venta(central.id, "2026-03-06T17:00:00.000Z", "600.00", "0.00"),
          // Cancelada el mismo día: cuenta como cancelación; su descuento, no.
          venta(central.id, "2026-03-07T17:00:00.000Z", "400.00", "40.00", "2026-03-07T18:00:00Z"),
          // Vendida en febrero, cancelada el 1 de marzo a las 00:30 en CDMX.
          venta(central.id, "2026-02-20T17:00:00.000Z", "250.00", "0.00", "2026-03-01T06:30:00Z"),
          // Vendida en febrero, cancelada el 28 de febrero a las 23:30 en CDMX.
          venta(central.id, "2026-02-27T17:00:00.000Z", "99.00", "0.00", "2026-03-01T05:30:00Z"),
          // Febrero, con descuento: no es de marzo.
          venta(central.id, "2026-02-10T17:00:00.000Z", "500.00", "50.00"),
          // Norte, marzo.
          venta(norte.id, "2026-03-08T17:00:00.000Z", "2000.00", "300.00"),
          venta(norte.id, "2026-03-09T17:00:00.000Z", "150.00", "0.00", "2026-03-09T18:00:00Z"),
        ],
      });
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("un faltante de 200 y un sobrante de 200 NO dan cero: se dicen por separado", async () => {
    const semana = await service.control(usuario(), TODO, "week");

    expect(semana.cash).toEqual({
      shortage: { amount: "200.00", shifts: 1 },
      overage: { amount: "200.00", shifts: 1 },
      closedShifts: 3,
    });
  });

  it("los turnos son los CERRADOS en el periodo: el abierto no cuenta y el día es el del negocio", async () => {
    const mes = await service.control(usuario(), TODO, "month");
    const febrero = await service.control(usuario(), TODO, "prev_month");

    // 200 + 50.50 de Central y 30 de Norte; el abierto con −999, fuera.
    expect(mes.cash).toEqual({
      shortage: { amount: "280.50", shifts: 3 },
      overage: { amount: "200.00", shifts: 1 },
      closedShifts: 6,
    });
    // El que cerró el 28 de febrero a las 23:00 es de febrero, aunque en UTC sea marzo.
    expect(febrero.cash).toEqual({
      shortage: { amount: "77.00", shifts: 1 },
      overage: { amount: "0.00", shifts: 0 },
      closedShifts: 1,
    });
  });

  it("los descuentos son los de las ventas cobradas: el de una cancelada no suma", async () => {
    const mes = await service.control(usuario(), TODO, "month");

    // 100 de Central y 300 de Norte; los 40 de la cancelada, no.
    // Sobre lo que se habría cobrado sin descuento: 400 ÷ (3,600 + 400) = 10%.
    expect(mes.discounts).toEqual({ amount: "400.00", tickets: 2, pctOfSales: 10 });
  });

  it("la cancelación cuenta por su fecha de cancelación, en la zona del negocio", async () => {
    const mes = await service.control(usuario(), TODO, "month");
    const febrero = await service.control(usuario(), TODO, "prev_month");

    // 400 (cancelada el 7), 250 (vendida en febrero, cancelada el 1 a las
    // 00:30) y 150 de Norte. La de 99 se canceló el 28 de febrero, hora local.
    expect(mes.cancellations).toEqual({ count: 3, amount: "800.00" });
    expect(febrero.cancellations).toEqual({ count: 1, amount: "99.00" });
  });

  it("con alcance a una sucursal, cada número es solo de ella", async () => {
    const central = await service.control(usuario(), { warehouseIds: [centralId] }, "month");
    const norte = await service.control(usuario(), { warehouseIds: [norteId] }, "month");

    expect(central).toEqual({
      cash: {
        shortage: { amount: "250.50", shifts: 2 },
        overage: { amount: "200.00", shifts: 1 },
        closedShifts: 5,
      },
      // 100 ÷ (1,600 + 100) = 5.88%.
      discounts: { amount: "100.00", tickets: 1, pctOfSales: 5.9 },
      cancellations: { count: 2, amount: "650.00" },
      range: { from: "2026-03-01", to: "2026-03-15" },
    });
    expect(norte.cash.shortage).toEqual({ amount: "30.00", shifts: 1 });
    expect(norte.discounts).toEqual({ amount: "300.00", tickets: 1, pctOfSales: 13 });
    expect(norte.cancellations).toEqual({ count: 1, amount: "150.00" });
  });

  it("un periodo vacío da ceros, y el porcentaje es null: sin ventas no hay de qué", async () => {
    const hoy = await service.control(usuario(), TODO, "today");

    expect(hoy).toEqual({
      cash: {
        shortage: { amount: "0.00", shifts: 0 },
        overage: { amount: "0.00", shifts: 0 },
        closedShifts: 0,
      },
      discounts: { amount: "0.00", tickets: 0, pctOfSales: null },
      cancellations: { count: 0, amount: "0.00" },
      range: { from: "2026-03-15", to: "2026-03-15" },
    });
  });

  it("dice las fechas del periodo en el calendario del negocio, para enlazar los reportes", async () => {
    const semana = await service.control(usuario(), TODO, "week");
    const febrero = await service.control(usuario(), TODO, "prev_month");

    // La semana arranca el lunes; el mes anterior termina el último día de febrero.
    expect(semana.range).toEqual({ from: "2026-03-09", to: "2026-03-15" });
    expect(febrero.range).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("no lee `user.userId`: el actor del backoffice no trae uno de este negocio", async () => {
    const actor = { tenantId, permissions: ["reports:read", "inventory:read"], locale: "es" };
    Object.defineProperty(actor, "userId", {
      get() {
        throw new Error("DashboardControlService leyó user.userId");
      },
    });

    const mes = await service.control(actor as AuthUser, TODO, "month");

    expect(mes.cancellations.count).toBe(3);
  });

  it("hace todas sus consultas dentro de UNA sola transacción", async () => {
    let transacciones = 0;
    // Cualquier cosa del cliente que no sea `withTenantContext` revienta:
    // así ninguna consulta se escapa de la transacción.
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
    const contado = new DashboardControlService(soloUnaTransaccion, relojFalso);

    const mes = await contado.control(usuario(), TODO, "month");

    expect(transacciones).toBe(1);
    expect(mes.discounts.amount).toBe("400.00");
  });
});
