import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F9-SUPPL-01: la tabla `suppliers`.
 *
 * Lo que fija:
 *  - la RLS canónica desde el minuto cero (con el rol REAL de la app, sin
 *    bypass): sin contexto cero filas, y A no ve a B;
 *  - el teléfono es E.164 y el nombre no puede ser vacío (CHECKs);
 *  - `is_active` nace en `true`.
 *
 * Cuando exista la primera FK desde compras o gastos, este spec gana el caso
 * «borrar un proveedor referenciado rebota» (riesgo 1 de F9-SUPPL).
 */
describe("modelo de datos de proveedores (F9-SUPPL-01)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  const stamp = Date.now();

  /** Transacción con el rol REAL de la app (sin bypass de RLS). */
  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    tenantA = (await prisma.tenant.create({ data: { name: `Suppl A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Suppl B ${stamp}` } })).id;
    for (const tenantId of [tenantA, tenantB]) {
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.supplier.create({
          data: {
            tenantId,
            code: "DISTRIBUIDORA-NORTE-5",
            name: "Distribuidora Norte",
            taxId: "DNO900101AB1",
          },
        }),
      );
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("RLS: sin contexto de tenant, cero filas con el rol real de la app", async () => {
    const filas = await asAppRole((tx) => tx.supplier.findMany());
    expect(filas).toHaveLength(0);
  });

  it("RLS: el contexto del tenant A no ve al proveedor del tenant B", async () => {
    const filas = await asAppRole(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
      return tx.supplier.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    });
    expect(filas.map((f) => f.tenantId)).toEqual([tenantA]);
  });

  it("un teléfono que no es E.164 rebota en el CHECK", async () => {
    await expect(
      prisma.withTenantContext(tenantA, (tx) =>
        tx.supplier.create({
          data: {
            tenantId: tenantA,
            code: "PAPELERA-SUR-6",
            name: "Papelera Sur",
            phone: "5512345678",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("un nombre en blanco rebota en el CHECK", async () => {
    await expect(
      prisma.withTenantContext(tenantA, (tx) =>
        tx.supplier.create({ data: { tenantId: tenantA, code: "PROV-7", name: "   " } }),
      ),
    ).rejects.toThrow();
  });

  it("nace activo", async () => {
    const creado = await prisma.withTenantContext(tenantA, (tx) =>
      tx.supplier.create({
        data: { tenantId: tenantA, code: "FERRETERA-CENTRO-8", name: "Ferretera Centro" },
      }),
    );
    expect(creado.isActive).toBe(true);
    expect(creado.attributes).toEqual({});
  });
});
