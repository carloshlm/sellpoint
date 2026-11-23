import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F10-CASHMOV-01: el
 * aislamiento por negocio de `cash_movements`, las entradas y los retiros de
 * efectivo del turno.
 *
 * Igual que en `f4-pos-rls`, los canarios son de COMPORTAMIENTO: una política
 * que existe no es una política que filtra. El estructural sigue haciendo
 * falta porque el FORCE solo se ve en el catálogo (la app conecta como
 * `sellpoint_app`, que no es dueña de la tabla).
 */
describe("RLS de las entradas y retiros de efectivo (F10-CASHMOV-01)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  /** Lo sembrado de cada negocio: su usuario, su turno y su movimiento. */
  const sembrado: Record<string, { usuario: string; turno: string; movimiento: string }> = {};

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const [a, b] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant CashMov A ${stamp}` } }),
      prisma.tenant.create({ data: { name: `Tenant CashMov B ${stamp}` } }),
    ]);
    tenantAId = a.id;
    tenantBId = b.id;

    for (const [tenantId, sufijo] of [
      [tenantAId, "a"],
      [tenantBId, "b"],
    ] as const) {
      sembrado[tenantId] = await prisma.withTenantContext(tenantId, async (tx) => {
        const usuario = await tx.user.create({
          data: {
            tenantId,
            email: `cashmov-rls-${stamp}-${sufijo}@example.com`,
            passwordHash: "x",
            firstName: "Ana",
            lastName: "Pérez",
          },
        });
        const almacen = await tx.warehouse.create({
          data: { tenantId, code: "CEN", name: `Central ${sufijo}` },
        });
        const turno = await tx.cashboxSession.create({
          data: {
            folio: `TUR-${randomUUID().slice(0, 8)}`,
            tenantId,
            warehouseId: almacen.id,
            openedBy: usuario.id,
          },
        });
        const movimiento = await tx.cashMovement.create({
          data: {
            tenantId,
            cashboxSessionId: turno.id,
            type: "out",
            reason: "safe",
            amount: "2000.00",
            createdBy: usuario.id,
          },
        });
        return { usuario: usuario.id, turno: turno.id, movimiento: movimiento.id };
      });
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const deA = () => sembrado[tenantAId] as { usuario: string; turno: string; movimiento: string };
  const deB = () => sembrado[tenantBId] as { usuario: string; turno: string; movimiento: string };

  it("la tabla tiene ENABLE, FORCE y una sola política tenant_isolation", async () => {
    const [fila] = await prisma.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
    >`SELECT c.relrowsecurity, c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'cash_movements'`;
    expect(fila).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 1n });
  });

  it("el rol de la app puede leer, escribir, actualizar y borrar (los GRANT por omisión)", async () => {
    const [fila] = await prisma.$queryRaw<
      { leer: boolean; escribir: boolean; actualizar: boolean; borrar: boolean }[]
    >`SELECT has_table_privilege('sellpoint_app', 'public.cash_movements', 'SELECT') AS leer,
             has_table_privilege('sellpoint_app', 'public.cash_movements', 'INSERT') AS escribir,
             has_table_privilege('sellpoint_app', 'public.cash_movements', 'UPDATE') AS actualizar,
             has_table_privilege('sellpoint_app', 'public.cash_movements', 'DELETE') AS borrar`;
    expect(fila).toEqual({ leer: true, escribir: true, actualizar: true, borrar: true });
  });

  it("con su contexto, cada negocio ve SOLO su movimiento", async () => {
    const vistosPorA = await prisma.withTenantContext(tenantAId, (tx) =>
      tx.cashMovement.findMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }),
    );
    expect(vistosPorA.map((m) => m.id)).toEqual([deA().movimiento]);

    const vistosPorB = await prisma.withTenantContext(tenantBId, (tx) =>
      tx.cashMovement.findMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }),
    );
    expect(vistosPorB.map((m) => m.id)).toEqual([deB().movimiento]);
  });

  it("sin contexto de negocio no devuelve filas", async () => {
    const [fila] = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*)::bigint AS n FROM cash_movements`;
    expect(Number(fila?.n)).toBe(0);
  });

  it("el movimiento de otro negocio es invisible, no solo inaccesible", async () => {
    const encontrado = await prisma.withTenantContext(tenantAId, (tx) =>
      tx.cashMovement.findUnique({ where: { id: deB().movimiento } }),
    );
    expect(encontrado).toBeNull();
  });

  it("con el contexto de A no se escribe un movimiento a nombre de B (WITH CHECK)", async () => {
    await expect(
      prisma.withTenantContext(tenantAId, (tx) =>
        tx.cashMovement.create({
          data: {
            tenantId: tenantBId,
            cashboxSessionId: deB().turno,
            type: "in",
            reason: "change_fund",
            amount: "500.00",
            createdBy: deB().usuario,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("con el contexto de A no se anula ni se borra el movimiento de B", async () => {
    const { anulados, borrados } = await prisma.withTenantContext(tenantAId, async (tx) => {
      const anulados = await tx.cashMovement.updateMany({
        where: { id: deB().movimiento },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          canceledBy: deA().usuario,
          cancelReason: "intruso",
        },
      });
      const borrados = await tx.cashMovement.deleteMany({ where: { id: deB().movimiento } });
      return { anulados: anulados.count, borrados: borrados.count };
    });
    expect({ anulados, borrados }).toEqual({ anulados: 0, borrados: 0 });

    const intacto = await prisma.withTenantContext(tenantBId, (tx) =>
      tx.cashMovement.findUnique({ where: { id: deB().movimiento } }),
    );
    expect(intacto).toMatchObject({ status: "active", canceledAt: null, cancelReason: null });
  });
});
