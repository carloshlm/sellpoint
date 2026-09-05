import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "./prisma.service";

/**
 * F7-LIFECYCLE-02 — el estado «desactivado» en `tenants` y la función
 * `purge_tenant(uuid)`: la única definición de «borrar un negocio», llamada
 * con el rol REAL de la app (SECURITY DEFINER hace el resto).
 */
describe("ciclo de vida del negocio: tenants.suspended_* y purge_tenant() (F7-LIFECYCLE-02)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let usuarioB: string;
  const stamp = Date.now();

  /** Transacción con el rol real de la app: sin bypass de RLS ni superusuario. */
  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  /** Filas con ese tenant_id en TODAS las tablas base que lo llevan (consulta dinámica). */
  async function filasDelNegocio(tenantId: string): Promise<Record<string, number>> {
    const tablas = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`;
    const conteo: Record<string, number> = {};
    // La conexión de los specs es el rol de la app, sujeto a RLS: sin el
    // contexto del negocio, toda tabla con FORCE RLS devuelve cero filas.
    await prisma.withTenantContext(tenantId, async (tx) => {
      for (const { table_name } of tablas) {
        const [fila] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*)::bigint AS n FROM "${table_name}" WHERE tenant_id = $1::uuid`,
          tenantId,
        );
        if (fila && Number(fila.n) > 0) conteo[table_name] = Number(fila.n);
      }
    });
    return conteo;
  }

  const sembrarUsuario = async (tenantId: string, sufijo: string) =>
    (
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.user.create({
          data: {
            tenantId,
            email: `lc-${stamp}-${sufijo}@example.com`,
            firstName: "Ana",
            lastNamePaternal: "Pérez",
          },
        }),
      )
    ).id;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    tenantA = (await prisma.tenant.create({ data: { name: `Vive A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Se va B ${stamp}` } })).id;
    await sembrarUsuario(tenantA, "a");
    usuarioB = await sembrarUsuario(tenantB, "b");
    // Un negocio con vida: rol asignado, almacén, producto, cliente, turno,
    // sesión viva y auditoría. Lo que un DELETE ingenuo dejaría huérfano.
    await prisma.withTenantContext(tenantB, async (tx) => {
      const rol = await tx.role.create({ data: { tenantId: tenantB, name: "Cajero" } });
      await tx.userRole.create({ data: { userId: usuarioB, roleId: rol.id } });
      await tx.warehouse.create({ data: { tenantId: tenantB, code: "CEN", name: "Central" } });
      await tx.product.create({ data: { tenantId: tenantB, sku: "SKU-1", name: "Cosa" } });
      await tx.customer.create({
        data: { tenantId: tenantB, firstName: "Luis", lastNamePaternal: "Lara" },
      });
      await tx.receptionTurn.create({
        data: { tenantId: tenantB, businessDate: new Date("2026-09-04"), number: 1 },
      });
      await tx.refreshToken.create({
        data: {
          tenantId: tenantB,
          userId: usuarioB,
          tokenHash: `hash-${stamp}`,
          familyId: "6f1a2b3c-0000-4000-8000-000000000001",
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await tx.auditLog.create({
        data: { tenantId: tenantB, action: "test.seed", resourceType: "tenant" },
      });
    });
  });

  afterAll(async () => {
    // A se limpia con la propia función (queda probada dos veces).
    await prisma.tenant.update({
      where: { id: tenantA },
      data: { suspendedAt: new Date(), suspendedReason: "fin del spec" },
    });
    await prisma.$queryRaw`SELECT purge_tenant(${tenantA}::uuid)`;
    await prisma.onModuleDestroy();
  });

  it("suspended_at sin motivo (o motivo sin fecha) rebota en el CHECK", async () => {
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { suspendedAt: new Date() } }),
    ).rejects.toThrow();
    await expect(
      prisma.tenant.update({ where: { id: tenantA }, data: { suspendedReason: "sin fecha" } }),
    ).rejects.toThrow();
  });

  it("purge_tenant sobre un negocio ACTIVO falla y no toca nada", async () => {
    await expect(
      asAppRole((tx) => tx.$queryRaw`SELECT purge_tenant(${tenantB}::uuid)`),
    ).rejects.toThrow(/ACTIVO/);
    expect(await prisma.tenant.findUnique({ where: { id: tenantB } })).not.toBeNull();
    expect(Object.keys(await filasDelNegocio(tenantB)).length).toBeGreaterThanOrEqual(8);
  });

  it("purge_tenant sobre un id inexistente falla con no existe", async () => {
    await expect(
      asAppRole(
        (tx) => tx.$queryRaw`SELECT purge_tenant('00000000-0000-4000-8000-000000000000'::uuid)`,
      ),
    ).rejects.toThrow(/no existe/);
  });

  it("desactivado, el rol de la app lo borra entero y los demás negocios siguen", async () => {
    await prisma.tenant.update({
      where: { id: tenantB },
      data: { suspendedAt: new Date("2026-08-01T00:00:00Z"), suspendedReason: "Pruebas" },
    });
    const antes = await filasDelNegocio(tenantB);
    expect(antes.users).toBe(1);
    expect(antes.reception_turns).toBe(1);

    const [fila] = await asAppRole(
      (tx) =>
        tx.$queryRaw<
          { purge_tenant: { name: string; users: number; sales: number; tables: number } }[]
        >`SELECT purge_tenant(${tenantB}::uuid)`,
    );
    const resumen = fila?.purge_tenant;
    expect(resumen).toMatchObject({ name: `Se va B ${stamp}`, users: 1, sales: 0 });
    expect(resumen?.tables).toBeGreaterThanOrEqual(40);

    expect(await prisma.tenant.findUnique({ where: { id: tenantB } })).toBeNull();
    expect(await filasDelNegocio(tenantB)).toEqual({});
    // `user_roles` no lleva tenant_id: con `replica` el CASCADE no corre y la
    // función las limpia a mano. Se mira la del usuario borrado (un conteo
    // global de huérfanas, como rol de la app y bajo RLS, no vería `users`).
    const asignaciones = await prisma.withTenantContext(tenantB, (tx) =>
      tx.userRole.count({ where: { userId: usuarioB } }),
    );
    expect(asignaciones).toBe(0);
    expect((await filasDelNegocio(tenantA)).users).toBe(1);
  });
});
