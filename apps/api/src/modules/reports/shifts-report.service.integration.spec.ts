import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { shiftsReportQuerySchema } from "./dto/shifts-report.dto";
import { ShiftsReportService } from "./shifts-report.service";

/**
 * F10-KPI-13 — «Cierres de turno» filtra por diferencia y la totaliza
 * (integration, Postgres real).
 *
 * Hoy, para encontrar los turnos con faltante hay que recorrer la lista
 * completa. El filtro «Diferencia» deja solo los cerrados con faltante
 * (`cash_difference < 0`), con sobrante (`> 0`) o que cuadraron (`= 0`), y el
 * pie dice cuánto faltó y cuánto sobró en el periodo, por separado: un
 * faltante nunca se compensa con un sobrante.
 */
describe("ShiftsReportService — la diferencia (integration)", () => {
  let prisma: PrismaService;
  let service: ShiftsReportService;

  let tenantId: string;
  let anaId: string;
  const SCOPE = { warehouseIds: "all" as const };
  const usuario = () => ({
    userId: anaId,
    tenantId,
    permissions: ["reports:read"],
    locale: "es" as const,
  });
  const consulta = (crudo: Record<string, unknown> = {}) => shiftsReportQuerySchema.parse(crudo);

  /** Un prefijo propio: buscar por él trae abiertos y cerrados de este spec. */
  const PREFIJO = `K13${randomUUID().slice(0, 5)}`;
  const folio = (nombre: string) => `${PREFIJO}-${nombre}`;
  const CERRADO_EN = new Date("2026-11-20T23:00:00.000Z");

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    service = new ShiftsReportService(prisma);

    const tenant = await prisma.tenant.create({
      data: { name: `Diferencias ${randomUUID().slice(0, 6)}`, timezone: "America/Mexico_City" },
    });
    tenantId = tenant.id;
    await prisma.withTenantContext(tenantId, async (tx) => {
      const persona = (nombre: string) =>
        tx.user.create({
          data: {
            tenantId,
            email: `${nombre}-${randomUUID()}@example.com`,
            firstName: nombre,
            lastName: "Caja",
          },
        });
      const [ana, beto, caro] = await Promise.all([
        persona("Ana"),
        persona("Beto"),
        persona("Caro"),
      ]);
      anaId = ana.id;
      const almacen = await tx.warehouse.create({
        data: { tenantId, code: `WH-${Math.random().toString(36).slice(2, 10)}`, name: "Central" },
      });
      const cerrado = (nombre: string, cashDifference: string | null) => ({
        tenantId,
        folio: folio(nombre),
        warehouseId: almacen.id,
        openedBy: ana.id,
        status: "closed" as const,
        closedBy: ana.id,
        closedAt: CERRADO_EN,
        calculatedCash: cashDifference === null ? null : "100.00",
        declaredCash: cashDifference === null ? null : "100.00",
        cashDifference,
      });
      await tx.cashboxSession.createMany({
        data: [
          cerrado("faltan10", "-10.00"),
          cerrado("faltan2", "-2.50"),
          cerrado("sobran5", "5.00"),
          cerrado("cuadro", "0.00"),
          // Un cierre sin arqueo (sin diferencia guardada) no «cuadró»: no se sabe.
          cerrado("sinArqueo", null),
          // Un turno abierto todavía no tiene diferencia.
          {
            tenantId,
            folio: folio("abierto"),
            warehouseId: almacen.id,
            openedBy: beto.id,
          },
          // Un abierto con una diferencia que no debería existir: el filtro es
          // de CERRADOS, y lo dice el código, no la casualidad de un null.
          {
            tenantId,
            folio: folio("raro"),
            warehouseId: almacen.id,
            openedBy: caro.id,
            cashDifference: "-7.00",
          },
        ],
      });
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const folios = (rows: { folio: string }[]) => rows.map((r) => r.folio).sort();

  it("«Con faltante», «Con sobrante» y «Cuadró» dejan solo esos cierres", async () => {
    const faltante = await service.list(usuario(), SCOPE, consulta({ difference: "shortage" }));
    const sobrante = await service.list(usuario(), SCOPE, consulta({ difference: "overage" }));
    const cuadro = await service.list(usuario(), SCOPE, consulta({ difference: "balanced" }));

    expect(folios(faltante.rows)).toEqual([folio("faltan10"), folio("faltan2")].sort());
    expect(faltante.total).toBe(2);
    expect(folios(sobrante.rows)).toEqual([folio("sobran5")]);
    // El cierre sin arqueo no cuenta como cuadrado.
    expect(folios(cuadro.rows)).toEqual([folio("cuadro")]);
  });

  it("los abiertos quedan fuera, aunque se busque en abiertos y cerrados", async () => {
    // Buscando por folio se listan abiertos y cerrados: con la diferencia, solo cerrados.
    const buscando = await service.list(
      usuario(),
      SCOPE,
      consulta({ search: PREFIJO, difference: "shortage" }),
    );
    const abiertos = await service.list(
      usuario(),
      SCOPE,
      consulta({ status: "open", difference: "shortage" }),
    );

    expect(folios(buscando.rows)).toEqual([folio("faltan10"), folio("faltan2")].sort());
    expect(abiertos.rows).toEqual([]);
    // Buscando sin el filtro se listan los abiertos, pero el pie suma solo cierres.
    const todos = await service.list(usuario(), SCOPE, consulta({ search: PREFIJO }));
    expect(todos.total).toBe(7);
    expect(todos.differenceTotals).toEqual({ shortage: "12.50", overage: "5.00" });
    // El export cuenta con `count`: cuenta lo mismo que la tabla.
    expect(
      await service.count(usuario(), SCOPE, consulta({ search: PREFIJO, difference: "shortage" })),
    ).toBe(2);
  });

  it("el pie dice cuánto faltó y cuánto sobró en TODO el periodo, no en la página", async () => {
    const pagina = await service.list(usuario(), SCOPE, consulta({ pageSize: "1" }));

    expect(pagina.rows).toHaveLength(1);
    // 10.00 + 2.50 faltaron y 5.00 sobraron: por separado, nunca 7.50 «netos».
    // El abierto «raro» no suma: no es un cierre.
    expect(pagina.differenceTotals).toEqual({ shortage: "12.50", overage: "5.00" });
  });

  it("el pie respeta los filtros: con «Con faltante» no sobró nada", async () => {
    const faltante = await service.list(usuario(), SCOPE, consulta({ difference: "shortage" }));
    const futuro = await service.list(usuario(), SCOPE, consulta({ from: "2099-01-01" }));

    expect(faltante.differenceTotals).toEqual({ shortage: "12.50", overage: "0.00" });
    expect(futuro.total).toBe(0);
    expect(futuro.differenceTotals).toEqual({ shortage: "0.00", overage: "0.00" });
  });

  it("sin el filtro, la lista es la de siempre: todos los cerrados", async () => {
    const todos = await service.list(usuario(), SCOPE, consulta());

    expect(todos.total).toBe(5);
    expect(folios(todos.rows)).toEqual(
      ["faltan10", "faltan2", "sobran5", "cuadro", "sinArqueo"].map(folio).sort(),
    );
  });
});

/**
 * F10-CASHMOV-06 — «Cierres de turno» con las entradas y los retiros de
 * efectivo (integration, Postgres real).
 *
 * La lista gana `cashIn` y `cashOut` al final de cada fila (la suma de los
 * ACTIVOS, `"0"` sin movimientos), en UNA consulta para toda la página. El
 * detalle gana además `movements`: la misma fila que la caja, del más viejo al
 * más nuevo, con los anulados. Nada de otro turno ni de otro negocio.
 */
describe("ShiftsReportService — las entradas y los retiros (integration)", () => {
  let prisma: PrismaService;
  let service: ShiftsReportService;
  let tenantId: string;
  let anaId: string;
  let betoId: string;
  const turnos: Record<"conMovimientos" | "soloRetiro" | "sinMovimientos", string> = {
    conMovimientos: "",
    soloRetiro: "",
    sinMovimientos: "",
  };
  const movimientos: string[] = [];
  const SCOPE = { warehouseIds: "all" as const };
  const usuario = () => ({
    userId: anaId,
    tenantId,
    permissions: ["reports:read"],
    locale: "es" as const,
  });
  const consulta = (crudo: Record<string, unknown> = {}) => shiftsReportQuerySchema.parse(crudo);
  const hora = (minuto: number) => new Date(Date.UTC(2026, 10, 20, 15, minuto));

  /** Un negocio con dos personas, su sucursal y tres turnos cerrados. */
  async function sembrar(nombre: string) {
    const tenant = await prisma.tenant.create({
      data: { name: `${nombre} ${randomUUID().slice(0, 6)}`, timezone: "America/Mexico_City" },
    });
    return prisma.withTenantContext(tenant.id, async (tx) => {
      const persona = (firstName: string) =>
        tx.user.create({
          data: {
            tenantId: tenant.id,
            email: `${firstName}-${randomUUID()}@example.com`,
            firstName,
            lastName: "Caja",
          },
        });
      const ana = await persona("Ana");
      const beto = await persona("Beto");
      const almacen = await tx.warehouse.create({
        data: { tenantId: tenant.id, code: "CEN", name: "Central" },
      });
      const cerrado = (folio: string, openedBy: string) =>
        tx.cashboxSession.create({
          data: {
            tenantId: tenant.id,
            folio: `${folio}-${randomUUID().slice(0, 6)}`,
            warehouseId: almacen.id,
            openedBy,
            status: "closed",
            closedBy: openedBy,
            closedAt: hora(50),
            calculatedCash: "0.00",
            declaredCash: "0.00",
            cashDifference: "0.00",
          },
        });
      return {
        tenantId: tenant.id,
        ana: ana.id,
        beto: beto.id,
        conMovimientos: (await cerrado("CM", ana.id)).id,
        soloRetiro: (await cerrado("SR", beto.id)).id,
        sinMovimientos: (await cerrado("SM", ana.id)).id,
      };
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    service = new ShiftsReportService(prisma);

    const negocio = await sembrar("Movimientos");
    tenantId = negocio.tenantId;
    anaId = negocio.ana;
    betoId = negocio.beto;
    turnos.conMovimientos = negocio.conMovimientos;
    turnos.soloRetiro = negocio.soloRetiro;
    turnos.sinMovimientos = negocio.sinMovimientos;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const mover = async (data: Record<string, unknown>) =>
        (
          await tx.cashMovement.create({
            data: { tenantId, createdBy: anaId, ...data } as never,
          })
        ).id;
      // Creados fuera de orden a propósito: el detalle los ordena por su hora.
      const retiro = await mover({
        cashboxSessionId: turnos.conMovimientos,
        type: "out",
        reason: "safe",
        amount: "2000.00",
        authorized: true,
        createdAt: hora(20),
      });
      const entrada = await mover({
        cashboxSessionId: turnos.conMovimientos,
        type: "in",
        reason: "change_fund",
        amount: "400.00",
        createdAt: hora(10),
      });
      const anulado = await mover({
        cashboxSessionId: turnos.conMovimientos,
        type: "out",
        reason: "owner",
        amount: "300.00",
        createdAt: hora(30),
        status: "canceled",
        canceledAt: hora(31),
        canceledBy: betoId,
        cancelReason: "Se equivocó de cajón",
      });
      movimientos.push(entrada, retiro, anulado);
      await mover({
        cashboxSessionId: turnos.soloRetiro,
        type: "out",
        reason: "bank_deposit",
        amount: "999.00",
        createdAt: hora(15),
      });
    });

    // Otro negocio con su retiro: no se cuela en este.
    const otro = await sembrar("Ajeno");
    await prisma.withTenantContext(otro.tenantId, (tx) =>
      tx.cashMovement.create({
        data: {
          tenantId: otro.tenantId,
          cashboxSessionId: otro.conMovimientos,
          createdBy: otro.ana,
          type: "out",
          reason: "safe",
          amount: "5000.00",
        },
      }),
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const fila = (rows: { id: string }[], id: string) => rows.find((r) => r.id === id);

  it("cada fila gana entradas y retiros activos AL FINAL, en «0» sin movimientos", async () => {
    const { rows } = await service.list(usuario(), SCOPE, consulta());

    expect(rows).toHaveLength(3);
    expect(fila(rows, turnos.conMovimientos)).toMatchObject({ cashIn: "400", cashOut: "2000" });
    expect(fila(rows, turnos.soloRetiro)).toMatchObject({ cashIn: "0", cashOut: "999" });
    expect(fila(rows, turnos.sinMovimientos)).toMatchObject({ cashIn: "0", cashOut: "0" });
    for (const row of rows) {
      expect(Object.keys(row).slice(-3)).toEqual(["closingNote", "cashIn", "cashOut"]);
    }
  });

  it("la página entera lee los movimientos en UNA consulta, no una por fila", async () => {
    const llamadas: string[] = [];
    const contado = new Proxy(prisma, {
      get(objetivo, propiedad, receptor) {
        if (propiedad !== "withTenantContext") {
          return Reflect.get(objetivo, propiedad, receptor);
        }
        return (id: string, fn: (tx: unknown) => Promise<unknown>) =>
          objetivo.withTenantContext(id, (tx) =>
            fn(
              new Proxy(tx, {
                get(t, p, r) {
                  const valor = Reflect.get(t, p, r);
                  if (p !== "cashMovement") return valor;
                  return new Proxy(valor as object, {
                    get(m, metodo, rm) {
                      llamadas.push(String(metodo));
                      return Reflect.get(m, metodo, rm);
                    },
                  });
                },
              }),
            ),
          );
      },
    });

    const { rows } = await new ShiftsReportService(contado).list(usuario(), SCOPE, consulta());

    expect(rows).toHaveLength(3);
    expect(llamadas).toEqual(["groupBy"]);
  });

  it("el export lee lo mismo: cada fila con sus entradas y retiros", async () => {
    const filas = await service.all(usuario(), SCOPE, consulta());

    expect(fila(filas, turnos.conMovimientos)).toMatchObject({ cashIn: "400", cashOut: "2000" });
    expect(fila(filas, turnos.sinMovimientos)).toMatchObject({ cashIn: "0", cashOut: "0" });
  });

  it("el detalle trae los movimientos del turno, del más viejo al más nuevo, con el anulado", async () => {
    const detalle = await service.detail(usuario(), SCOPE, turnos.conMovimientos);

    expect(detalle).toMatchObject({ cashIn: "400", cashOut: "2000" });
    expect(Object.keys(detalle).slice(-4)).toEqual(["cashIn", "cashOut", "sales", "movements"]);
    expect(detalle.movements.map((m) => m.id)).toEqual(movimientos);
    expect(detalle.movements[0]).toEqual({
      id: movimientos[0],
      type: "in",
      reason: "change_fund",
      amount: "400",
      note: null,
      authorized: false,
      status: "active",
      createdAt: hora(10).toISOString(),
      createdBy: { id: anaId, name: "Ana Caja" },
      canceledAt: null,
      canceledBy: null,
      cancelReason: null,
    });
    expect(detalle.movements[1]).toMatchObject({ reason: "safe", authorized: true });
    expect(detalle.movements[2]).toMatchObject({
      status: "canceled",
      amount: "300",
      canceledAt: hora(31).toISOString(),
      canceledBy: { id: betoId, name: "Beto Caja" },
      cancelReason: "Se equivocó de cajón",
    });
  });

  it("el detalle no trae lo de otro turno ni lo de otro negocio; sin movimientos, la lista vacía", async () => {
    const soloRetiro = await service.detail(usuario(), SCOPE, turnos.soloRetiro);
    const sinMovimientos = await service.detail(usuario(), SCOPE, turnos.sinMovimientos);

    expect(soloRetiro.movements.map((m) => m.amount)).toEqual(["999"]);
    expect(sinMovimientos).toMatchObject({ cashIn: "0", cashOut: "0", movements: [] });
  });
});
