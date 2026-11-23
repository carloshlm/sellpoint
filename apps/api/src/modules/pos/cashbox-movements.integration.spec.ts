import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { DashboardControlService } from "../reports/dashboard-control.service";
import { DashboardKpisService } from "../reports/dashboard-kpis.service";
import { CashboxService } from "./cashbox.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F10-CASHMOV-03: el arqueo
 * cuenta las entradas y los retiros de efectivo.
 *
 * El problema que resuelve: el efectivo que se lleva a la caja fuerte salía
 * como FALTANTE en el cierre, en «Cierres de turno», en «Control» y en el aviso
 * del panel. Con esto, el turno que contó bien cierra en «Cuadró».
 *
 * Los movimientos se siembran directo con el cliente de Prisma: los endpoints
 * para registrarlos llegan con F10-CASHMOV-02. El turno se abre y se cierra
 * con el `CashboxService` de verdad, que es lo que se prueba.
 */
describe("el arqueo cuenta las entradas y los retiros de efectivo (F10-CASHMOV-03)", () => {
  let prisma: PrismaService;
  let service: CashboxService;
  /** El negocio y la sucursal de todo el archivo. */
  const principal = { tenantId: "", almacenId: "" };
  const TODO = { warehouseIds: "all" as const };
  const stamp = Date.now();

  type Movimiento = Omit<
    Prisma.CashMovementUncheckedCreateInput,
    "tenantId" | "cashboxSessionId" | "createdBy"
  >;

  /**
   * Un cajero nuevo con su turno abierto (uno abierto por persona): el fondo y
   * las ventas en efectivo que se le piden, ya cobradas. Sin `negocio`, en el
   * negocio y la sucursal de todo el archivo.
   */
  async function turnoAbierto(
    opciones: {
      fondo?: number;
      ventasCash?: string[];
      negocio?: { tenantId: string; almacenId: string };
    } = {},
  ) {
    const { tenantId, almacenId } = opciones.negocio ?? principal;
    const usuario = await prisma.withTenantContext(tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId,
          email: `cajero-${randomUUID()}@example.com`,
          firstName: "Luis",
          lastName: "Cajero",
        },
      }),
    );
    const cajero: AuthUser = {
      userId: usuario.id,
      tenantId,
      permissions: ["pos:sell"],
      locale: "es",
    };
    const turno = await service.open(cajero, TODO, {
      warehouseId: almacenId,
      ...(opciones.fondo !== undefined && { openingCash: opciones.fondo }),
    });
    for (const total of opciones.ventasCash ?? []) {
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.sale.create({
          data: {
            tenantId,
            folio: `VTA-${randomUUID().slice(0, 12)}`,
            warehouseId: almacenId,
            cashboxSessionId: turno.id,
            paymentMethod: "cash",
            subtotal: total,
            total,
            createdBy: usuario.id,
          },
        }),
      );
    }
    const mover = (movimiento: Movimiento) =>
      prisma.withTenantContext(tenantId, (tx) =>
        tx.cashMovement.create({
          data: {
            tenantId,
            cashboxSessionId: turno.id,
            createdBy: usuario.id,
            ...movimiento,
          },
        }),
      );
    return { cajero, turno, mover };
  }

  /** Los sellos de una anulación hecha por `usuario`. */
  const anulado = (usuario: string) => ({
    status: "canceled" as const,
    canceledAt: new Date(),
    canceledBy: usuario,
    cancelReason: "Se capturó dos veces",
  });

  /** Un negocio en CDMX con su sucursal Central. */
  async function negocioNuevo(nombre: string) {
    const tenantId = (
      await prisma.tenant.create({
        data: { name: `${nombre} ${stamp}`, timezone: "America/Mexico_City" },
      })
    ).id;
    const almacenId = (
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.create({ data: { tenantId, code: "CEN", name: "Central" } }),
      )
    ).id;
    return { tenantId, almacenId };
  }

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    service = new CashboxService(prisma);
    Object.assign(principal, await negocioNuevo("Arqueo CashMov"));
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("sin movimientos, el arqueo es el de siempre y dice entradas y retiros en «0»", async () => {
    const { cajero, turno } = await turnoAbierto({ fondo: 500, ventasCash: ["150.00"] });

    const arqueo = await service.totals(cajero, turno);

    expect(arqueo).toMatchObject({ openingCash: "500", expectedCash: "650" });
    expect({ cashIn: arqueo.cashIn, cashOut: arqueo.cashOut }).toEqual({
      cashIn: "0",
      cashOut: "0",
    });
  });

  it("un retiro de 2,000 a la caja fuerte con 2,000 menos en el cajón cierra en «Cuadró»", async () => {
    const { cajero, turno, mover } = await turnoAbierto({ fondo: 500, ventasCash: ["3000.00"] });
    await mover({ type: "out", reason: "safe", amount: "2000.00", authorized: true });

    const antes = await service.totals(cajero, turno);
    expect(antes).toMatchObject({ expectedCash: "1500", cashIn: "0", cashOut: "2000" });

    // Fondo 500 + ventas 3,000 = 3,500; se llevaron 2,000: en el cajón hay 1,500.
    const cierre = await service.close(cajero, { declaredCash: 1500 });

    expect(cierre).toMatchObject({ expectedCash: "1500", cashIn: "0", cashOut: "2000" });
    expect({
      calculado: cierre.session.calculatedCash?.toString(),
      contado: cierre.session.declaredCash?.toString(),
      diferencia: cierre.session.cashDifference?.toString(),
    }).toEqual({ calculado: "1500", contado: "1500", diferencia: "0" });
  });

  it("una entrada de fondo para cambio suma al esperado", async () => {
    const { cajero, mover } = await turnoAbierto({ ventasCash: ["200.00"] });
    await mover({ type: "in", reason: "change_fund", amount: "400.00" });

    const cierre = await service.close(cajero, { declaredCash: 600 });

    expect(cierre).toMatchObject({ expectedCash: "600", cashIn: "400", cashOut: "0" });
    expect(cierre.session.cashDifference?.toString()).toBe("0");
  });

  it("un movimiento ANULADO no cuenta, ni entrada ni retiro", async () => {
    const { cajero, mover } = await turnoAbierto({ fondo: 1000 });
    await mover({ type: "out", reason: "bank_deposit", amount: "300.00" });
    await mover({ type: "out", reason: "owner", amount: "700.00", ...anulado(cajero.userId) });
    await mover({
      type: "in",
      reason: "other",
      note: "Cambio del dueño",
      amount: "250.00",
      ...anulado(cajero.userId),
    });

    const cierre = await service.close(cajero, { declaredCash: 700 });

    expect(cierre).toMatchObject({ expectedCash: "700", cashIn: "0", cashOut: "300" });
    expect(cierre.session.cashDifference?.toString()).toBe("0");
  });

  it("el movimiento de OTRO turno no cuenta en este", async () => {
    const otro = await turnoAbierto({ fondo: 100 });
    await otro.mover({ type: "out", reason: "safe", amount: "999.00" });
    await otro.mover({ type: "in", reason: "change_fund", amount: "50.00" });
    const { cajero, turno } = await turnoAbierto({ fondo: 100 });

    const arqueo = await service.totals(cajero, turno);
    const cierre = await service.close(cajero, { declaredCash: 100 });

    expect(arqueo).toMatchObject({ expectedCash: "100", cashIn: "0", cashOut: "0" });
    expect(cierre).toMatchObject({ expectedCash: "100", cashIn: "0", cashOut: "0" });
    expect(cierre.session.cashDifference?.toString()).toBe("0");
  });

  /**
   * F10-PEND-01 — el aviso del verificador de F10-CASHMOV: un movimiento que
   * gana la fila del turno se guardaba con una hora POSTERIOR a la del cierre
   * que lo contó, porque el cierre tomaba la hora antes de esperar la fila.
   * Aquí el movimiento toma la fila (como `CashMovementsService`), el cierre
   * llega y espera, y el movimiento se guarda mientras tanto.
   */
  it("un movimiento que ganó la fila del turno queda ANTES de la hora del cierre que lo cuenta", async () => {
    const { cajero, turno } = await turnoAbierto({ fondo: 100 });
    let soltar = () => {};
    const suelta = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    let avisarTomada = () => {};
    const tomada = new Promise<void>((resolve) => {
      avisarTomada = resolve;
    });
    const movimiento = prisma.withTenantContext(cajero.tenantId, async (tx) => {
      await tx.$queryRaw`
        SELECT 1 FROM cashbox_sessions WHERE id = ${turno.id}::uuid FOR UPDATE`;
      avisarTomada();
      await suelta;
      return tx.cashMovement.create({
        data: {
          tenantId: cajero.tenantId,
          cashboxSessionId: turno.id,
          createdBy: cajero.userId,
          type: "out",
          reason: "safe",
          amount: "40.00",
        },
      });
    });
    await tomada;

    const cierre = service.close(cajero, { declaredCash: 60 });
    // El cierre ya está formado detrás de la fila del turno.
    await new Promise((resolve) => setTimeout(resolve, 300));
    soltar();
    const creado = await movimiento;
    const cerrado = await cierre;

    expect(cerrado).toMatchObject({ expectedCash: "60", cashOut: "40" });
    expect(cerrado.session.closedAt?.getTime()).toBeGreaterThanOrEqual(creado.createdAt.getTime());
  });

  /**
   * F10-CASHMOV, decisión de arquitectura 7: lo nuevo va AL FINAL. Un web que
   * lee la respuesta por posición no existe, pero un web viejo durante el
   * deploy sí, y la regla es la misma en todas las respuestas.
   */
  it("`cashIn` y `cashOut` van al final de los totales y del cierre", async () => {
    const { cajero, turno, mover } = await turnoAbierto({ ventasCash: ["80.00"] });
    await mover({ type: "out", reason: "owner", amount: "30.00" });

    const arqueo = await service.totals(cajero, turno);
    const cierre = await service.close(cajero, { declaredCash: 50 });

    expect(Object.keys(arqueo)).toEqual([
      "totals",
      "cashExpenses",
      "openingCash",
      "expectedCash",
      "cashIn",
      "cashOut",
    ]);
    expect(Object.keys(cierre)).toEqual([
      "session",
      "totals",
      "cashExpenses",
      "openingCash",
      "expectedCash",
      "cashIn",
      "cashOut",
    ]);
  });

  /**
   * Lo que se apoya en el arqueo GUARDADO: «Control» y el aviso de faltantes
   * del panel leen `cash_difference`, así que con el retiro contado al cerrar
   * ya no acusan un faltante. El reloj es el de verdad: el cierre lo pone el
   * service con la hora de ahora.
   */
  describe("lo que se apoya en el arqueo", () => {
    let dueno: AuthUser;

    beforeAll(async () => {
      // Un negocio aparte: solo el turno de esta prueba cerró en él.
      const negocio = await negocioNuevo("Arqueo CashMov Panel");
      const { cajero, mover } = await turnoAbierto({
        fondo: 500,
        ventasCash: ["3000.00"],
        negocio,
      });
      await mover({ type: "out", reason: "safe", amount: "2000.00", authorized: true });
      await service.close(cajero, { declaredCash: 1500 });
      dueno = { ...cajero, permissions: ["reports:read"] };
    });

    const reloj = { now: () => new Date() };

    it("«Control» no ve faltante: el turno cuadró", async () => {
      const control = await new DashboardControlService(prisma, reloj).control(
        dueno,
        TODO,
        "today",
      );
      expect(control.cash).toEqual({
        shortage: { amount: "0.00", shifts: 0 },
        overage: { amount: "0.00", shifts: 0 },
        closedShifts: 1,
      });
    });

    it("el aviso del panel no cuenta faltantes", async () => {
      const kpis = await new DashboardKpisService(prisma, reloj).kpis(dueno, TODO);
      expect(kpis.attention.shiftShortages).toMatchObject({ count: 0, amount: "0.00" });
    });
  });
});
