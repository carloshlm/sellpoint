import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { dueInstant, localCalendarDate } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

const MIGRATION = join(
  __dirname,
  "../../../prisma/migrations/20260903010000_f7_backfill_subscriptions/migration.sql",
);

/**
 * Integration (Postgres real) — el backfill de suscripciones.
 *
 * Producción, 2026-09-02: un negocio registrado ANTES de la fase de cobros no
 * tenía fila en `tenant_subscriptions`, resolvía plan free y no podía ni
 * terminar el onboarding (402 al guardar el paso 1). El provisioning nuevo
 * crea el trial en la misma transacción (F7-CORE-03); a los anteriores nadie
 * se los dio. Esta migración les da el MISMO trial: 14 días de Plus contados
 * desde que corre, con el fin al arranque del día 15 local.
 */
describe("backfill de suscripciones para tenants anteriores a F7", () => {
  let prisma: PrismaService;
  /** La migración corre con el rol ADMIN (DATABASE_URL_ADMIN, prisma.config.ts): salta RLS. */
  let admin: PrismaClient;
  let sinSuscripcion: string;
  let conSuscripcion: string;
  let planFreeId: string;
  const stamp = Date.now();
  const sql = readFileSync(MIGRATION, "utf8");

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("Falta DATABASE_URL_ADMIN para replayar la migración");
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
    planFreeId = (await prisma.plan.findUniqueOrThrow({ where: { code: "free" } })).id;

    sinSuscripcion = (
      await prisma.tenant.create({
        data: { name: `Pre-F7 ${stamp}`, timezone: "America/Mexico_City" },
      })
    ).id;
    conSuscripcion = (await prisma.tenant.create({ data: { name: `Free ${stamp}` } })).id;
    await prisma.withTenantContext(conSuscripcion, async (tx) => {
      await tx.tenantSubscription.create({
        data: { tenantId: conSuscripcion, planId: planFreeId, status: "free" },
      });
    });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await prisma.onModuleDestroy();
  });

  it("al tenant sin fila le da el trial Plus de 14 días, al arranque del día 15 local", async () => {
    await admin.$executeRawUnsafe(sql);

    const sub = await prisma.withTenantContext(sinSuscripcion, (tx) =>
      tx.tenantSubscription.findUniqueOrThrow({
        where: { tenantId: sinSuscripcion },
        include: { plan: true },
      }),
    );
    expect(sub.status).toBe("trialing");
    expect(sub.plan.code).toBe("plus");

    const tz = "America/Mexico_City";
    const esperado = dueInstant(localCalendarDate(tz, new Date(Date.now() + 14 * 86_400_000)), tz);
    expect(sub.trialEndsAt?.toISOString()).toBe(esperado.toISOString());
  });

  it("no toca al tenant que ya tenía fila, y correr dos veces no duplica nada", async () => {
    await admin.$executeRawUnsafe(sql);
    await admin.$executeRawUnsafe(sql);

    const libre = await prisma.withTenantContext(conSuscripcion, (tx) =>
      tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId: conSuscripcion } }),
    );
    expect(libre.status).toBe("free");
    expect(libre.planId).toBe(planFreeId);

    const filas = await prisma.withTenantContext(sinSuscripcion, (tx) =>
      tx.tenantSubscription.count({ where: { tenantId: sinSuscripcion } }),
    );
    expect(filas).toBe(1);
  });
});
