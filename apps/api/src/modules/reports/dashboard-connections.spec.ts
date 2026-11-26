import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { DashboardProductsService } from "./dashboard-products.service";
import { DashboardSeriesService } from "./dashboard-series.service";
import { ItemsRankingService } from "./items-ranking.service";

/**
 * Sentry SELLPOINT-API-7 (2026-11-25): una sola carga del Panel pedía unas 16
 * conexiones a la vez —cinco «Más vendidos», cuatro las gráficas— contra un
 * pool de 10, y «Más vendidos» se rindió a los 2 s con «Unable to start a
 * transaction in the given time». Regla: cada sección del Panel abre UNA
 * transacción y hace sus consultas en fila dentro de ella.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const SCOPE: UserScope = { warehouseIds: "all" } as UserScope;
const AHORA = new Date("2026-11-25T23:59:00.000Z");
type Mock = jest.Mock;

describe("El Panel abre una sola transacción por sección (Sentry SELLPOINT-API-7)", () => {
  let queryRaw: Mock;
  let enVuelo: number;
  let maximoEnVuelo: number;
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  const reloj = { now: () => AHORA };

  beforeEach(() => {
    enVuelo = 0;
    maximoEnVuelo = 0;
    // Cada consulta tarda un tick: si dos corrieran a la vez, se notaría.
    queryRaw = jest.fn(async () => {
      enVuelo += 1;
      maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo);
      await new Promise((r) => setImmediate(r));
      enVuelo -= 1;
      return [];
    });
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: queryRaw }),
      ),
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "America/Mexico_City" }) },
    };
  });

  // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
  const fake = () => prisma as any;

  it("«Más vendidos / Mayor utilidad» hace sus 5 consultas en UNA transacción, una tras otra", async () => {
    const servicio = new DashboardProductsService(fake(), reloj, new ItemsRankingService(fake()));

    await servicio.products(USER, SCOPE, "month");

    expect(prisma.withTenantContext).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(5);
    expect(maximoEnVuelo).toBe(1);
  });

  it("las gráficas hacen sus 4 consultas en UNA transacción, una tras otra", async () => {
    const servicio = new DashboardSeriesService(fake(), reloj);

    await servicio.series(USER, SCOPE);

    expect(prisma.withTenantContext).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(maximoEnVuelo).toBe(1);
  });

  it("el reporte por artículo, sin transacción prestada, sigue abriendo la suya", async () => {
    const ranking = new ItemsRankingService(fake());

    await ranking.rank(TENANT, SCOPE, {
      order: "revenue",
      type: "all",
      limit: 10,
      offset: 0,
    });

    expect(prisma.withTenantContext).toHaveBeenCalledTimes(1);
    expect(prisma.withTenantContext).toHaveBeenCalledWith(TENANT, expect.any(Function));
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
