import { ConfigService } from "@nestjs/config";
import {
  PLAN_CODES,
  PLAN_LIMITS,
  PLAN_LINES,
  PLAN_RANK,
  type PlanCode,
  PUBLISHED_PLANS,
} from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F11-SITE-PLANS-01: la lista comercial de
 * `@sellpoint/shared` contra la tabla `plans`, que es la VERDAD.
 *
 * El sitio público se arma SIN llamar al API (es estático), así que anuncia
 * lo que diga `PLAN_LINES` y `PLAN_LIMITS`. Si una migración mueve un flag de
 * plan o cambia un límite y nadie toca la lista, el sitio promete algo que la
 * aplicación ya no da — y el que compra Basic creyendo que controla
 * existencias es un cliente que se va enojado. Esta prueba es el amarre.
 */
describe("la lista comercial coincide con la tabla plans (F11-SITE-PLANS-01)", () => {
  let prisma: PrismaService;
  let plans: Map<
    PlanCode,
    {
      stockControl: boolean;
      features: Record<string, unknown>;
      users: number | null;
      warehouses: number | null;
      isPublic: boolean;
    }
  >;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    const rows = await prisma.plan.findMany();
    plans = new Map(
      rows.map((row) => [
        row.code as PlanCode,
        {
          stockControl: row.stockControl,
          features: row.features as Record<string, unknown>,
          users: row.maxUsers,
          warehouses: row.maxWarehouses,
          isPublic: row.isPublic,
        },
      ]),
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("cada flag está prendido exactamente desde el plan mínimo que la lista anuncia", () => {
    for (const line of PLAN_LINES) {
      if (line.kind !== "feature") continue;
      for (const code of PLAN_CODES) {
        const plan = plans.get(code);
        expect(plan).toBeDefined();
        const enBase =
          line.key === "stockControl" ? plan?.stockControl : plan?.features[line.key] === true;
        const enLista = PLAN_RANK[code] >= PLAN_RANK[line.minPlan];
        expect({ linea: line.key, plan: code, incluye: enBase }).toEqual({
          linea: line.key,
          plan: code,
          incluye: enLista,
        });
      }
    }
  });

  it("los límites que el sitio anuncia son los de la base", () => {
    for (const code of PUBLISHED_PLANS) {
      const plan = plans.get(code);
      expect({ users: plan?.users, warehouses: plan?.warehouses }).toEqual(PLAN_LIMITS[code]);
    }
  });

  it("los planes publicados son los que la base marca como públicos con precio", () => {
    // Free y Premium existen, pero no se anuncian como tarjeta.
    for (const code of PUBLISHED_PLANS) expect(plans.get(code)?.isPublic).toBe(true);
  });
});
