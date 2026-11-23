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
