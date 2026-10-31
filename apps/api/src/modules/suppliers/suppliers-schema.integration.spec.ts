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
  /** El proveedor sembrado de cada negocio, con un contacto adicional cada uno. */
  const proveedorDe: Record<string, string> = {};
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
      const proveedor = await prisma.withTenantContext(tenantId, (tx) =>
        tx.supplier.create({
          data: {
            tenantId,
            code: "DISTRIBUIDORA-NORTE-5",
            name: "Distribuidora Norte",
            taxId: "DNO900101AB1",
            contacts: { create: [{ tenantId, sortOrder: 1, name: "Luis Compras" }] },
          },
        }),
      );
      proveedorDe[tenantId] = proveedor.id;
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
    // Contactos de proveedor (2026-10-31): las columnas nuevas nacen vacías.
    expect(creado).toMatchObject({
      jobTitle: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
    });
  });

  /**
   * Contactos de proveedor (Carlos, 2026-10-31): `supplier_contacts` guarda
   * los contactos ADICIONALES (el 1 sigue en `suppliers`). Lleva su propio
   * `tenant_id` —lo exige `purge_tenant`— y la RLS canónica.
   */
  describe("supplier_contacts", () => {
    const contacto = (
      tenantId: string,
      extra: Partial<Prisma.SupplierContactUncheckedCreateInput> = {},
    ): Prisma.SupplierContactUncheckedCreateInput => ({
      tenantId,
      supplierId: proveedorDe[tenantId] as string,
      sortOrder: 50,
      name: "Ana Pagos",
      ...extra,
    });

    it("RLS: ENABLE + FORCE y una sola política tenant_isolation", async () => {
      const [fila] = await prisma.$queryRaw<
        { relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
      >`SELECT c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy p
                 WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'supplier_contacts'`;
      expect(fila).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 1n });
    });

    it("RLS: sin contexto de tenant, cero contactos con el rol real de la app", async () => {
      const filas = await asAppRole((tx) => tx.supplierContact.findMany());
      expect(filas).toHaveLength(0);
    });

    it("RLS: el tenant A no ve los contactos del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.supplierContact.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      });
      expect(filas.map((f) => [f.tenantId, f.name])).toEqual([[tenantA, "Luis Compras"]]);
    });

    it("RLS: con el contexto de A no se escribe un contacto a nombre de B", async () => {
      await expect(
        asAppRole(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
          return tx.supplierContact.create({ data: contacto(tenantB) });
        }),
      ).rejects.toThrow();
    });

    it("un teléfono que no es E.164 rebota en el CHECK; uno E.164 entra", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.supplierContact.create({ data: contacto(tenantA, { phone: "5512345678" }) }),
        ),
      ).rejects.toThrow();
      const bueno = await prisma.withTenantContext(tenantA, (tx) =>
        tx.supplierContact.create({
          data: contacto(tenantA, { sortOrder: 51, phone: "+525512345678" }),
        }),
      );
      expect(bueno.phone).toBe("+525512345678");
    });

    it("un nombre en blanco rebota en el CHECK", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.supplierContact.create({ data: contacto(tenantA, { sortOrder: 52, name: "   " }) }),
        ),
      ).rejects.toThrow();
    });

    it("dos contactos del mismo proveedor no comparten posición", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.supplierContact.create({ data: contacto(tenantA, { sortOrder: 1 }) }),
        ),
      ).rejects.toThrow();
    });

    it("borrar el proveedor se lleva sus contactos (ON DELETE CASCADE)", async () => {
      const { proveedor, antes } = await prisma.withTenantContext(tenantA, async (tx) => {
        const creado = await tx.supplier.create({
          data: {
            tenantId: tenantA,
            code: "EFIMERO-9",
            name: "Efímero",
            contacts: {
              create: [
                { tenantId: tenantA, sortOrder: 1, name: "Uno" },
                { tenantId: tenantA, sortOrder: 2, name: "Dos" },
              ],
            },
          },
        });
        return {
          proveedor: creado.id,
          antes: await tx.supplierContact.count({ where: { supplierId: creado.id } }),
        };
      });
      expect(antes).toBe(2);
      const despues = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        await tx.supplier.delete({ where: { id: proveedor } });
        return tx.supplierContact.count({ where: { supplierId: proveedor } });
      });
      expect(despues).toBe(0);
    });
  });
});
