import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F4-TAX-04: el modelo de datos de impuestos.
 *
 * Lo que fija:
 *  - las cuatro tablas nuevas llevan la RLS canónica con FORCE desde el
 *    minuto cero, y se prueba con el rol REAL de la app en las cuatro
 *    operaciones (leer, insertar, actualizar, borrar), no solo leyendo;
 *  - un solo default ACTIVO por negocio (índice único parcial), que sí admite
 *    un default inactivo al lado;
 *  - los CHECK de tasa (0..100, cuatro decimales) y de modo;
 *  - un grupo con artículos no se borra (RESTRICT): se desactiva.
 */
describe("modelo de datos de impuestos (F4-TAX-04)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let grupoB: string;
  const stamp = Date.now();

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
    tenantA = (await prisma.tenant.create({ data: { name: `Tax A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Tax B ${stamp}` } })).id;
    grupoB = (
      await prisma.withTenantContext(tenantB, (tx) =>
        tx.taxGroup.create({
          data: {
            tenantId: tenantB,
            code: "VAT16",
            name: "IVA 16%",
            isDefault: true,
            rates: { create: { tenantId: tenantB, code: "VAT", name: "IVA 16%", rate: "16" } },
          },
        }),
      )
    ).id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("aislamiento por tenant, con el rol real de la app", () => {
    it("sin contexto de tenant, cero filas en las cuatro tablas", async () => {
      const conteos = await asAppRole((tx) =>
        Promise.all([
          tx.taxGroup.count(),
          tx.taxRate.count(),
          tx.saleTax.count(),
          tx.quoteTax.count(),
        ]),
      );
      expect(conteos).toEqual([0, 0, 0, 0]);
    });

    it("el contexto del tenant A no LEE, ni ACTUALIZA, ni BORRA el grupo del tenant B", async () => {
      const visto = await prisma.withTenantContext(tenantA, (tx) =>
        tx.taxGroup.count({ where: { id: grupoB } }),
      );
      expect(visto).toBe(0);
      const actualizados = await prisma.withTenantContext(tenantA, (tx) =>
        tx.taxGroup.updateMany({ where: { id: grupoB }, data: { name: "hackeado" } }),
      );
      expect(actualizados.count).toBe(0);
      const borrados = await prisma.withTenantContext(tenantA, (tx) =>
        tx.taxRate.deleteMany({ where: { taxGroupId: grupoB } }),
      );
      expect(borrados.count).toBe(0);
      const intacto = await prisma.withTenantContext(tenantB, (tx) =>
        tx.taxGroup.findUniqueOrThrow({ where: { id: grupoB }, include: { rates: true } }),
      );
      expect(intacto.name).toBe("IVA 16%");
      expect(intacto.rates).toHaveLength(1);
    });

    it("el contexto del tenant A no INSERTA a nombre del tenant B (WITH CHECK)", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.taxGroup.create({ data: { tenantId: tenantB, code: "COLADO", name: "Colado" } }),
        ),
      ).rejects.toThrow();
    });

    it("estructural: las cuatro tablas tienen RLS ENABLE + FORCE y la policy", async () => {
      const filas = await prisma.$queryRaw<
        {
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
          policies: bigint;
        }[]
      >`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policies
          FROM pg_class c
         WHERE c.relname IN ('tax_groups', 'tax_rates', 'sale_taxes', 'quote_taxes')
         ORDER BY c.relname`;
      expect(filas.map((f) => f.relname)).toEqual([
        "quote_taxes",
        "sale_taxes",
        "tax_groups",
        "tax_rates",
      ]);
      for (const f of filas) {
        expect(f.relrowsecurity).toBe(true);
        expect(f.relforcerowsecurity).toBe(true);
        expect(Number(f.policies)).toBe(1);
      }
    });
  });

  describe("un solo default activo por negocio", () => {
    it("dos defaults ACTIVOS del mismo negocio rebotan en el índice parcial", async () => {
      await prisma.withTenantContext(tenantA, (tx) =>
        tx.taxGroup.create({
          data: { tenantId: tenantA, code: "VAT16", name: "IVA 16%", isDefault: true },
        }),
      );
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.taxGroup.create({
            data: { tenantId: tenantA, code: "VAT8", name: "IVA 8%", isDefault: true },
          }),
        ),
      ).rejects.toThrow();
    });

    it("un default INACTIVO al lado del activo sí cabe: desactivar no borra la marca", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.taxGroup.create({
            data: {
              tenantId: tenantA,
              code: "VIEJO",
              name: "Viejo default",
              isDefault: true,
              isActive: false,
            },
          }),
        ),
      ).resolves.toMatchObject({ code: "VIEJO" });
    });

    it("el mismo código en OTRO negocio existe: el UNIQUE es por tenant", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.taxGroup.create({ data: { tenantId: tenantA, code: "EXEMPT", name: "Exento" } }),
        ),
      ).resolves.toMatchObject({ code: "EXEMPT" });
      await expect(
        prisma.withTenantContext(tenantB, (tx) =>
          tx.taxGroup.create({ data: { tenantId: tenantB, code: "EXEMPT", name: "Exento" } }),
        ),
      ).resolves.toMatchObject({ code: "EXEMPT" });
    });
  });

  describe("los CHECK", () => {
    it("una tasa fuera de 0..100 rebota; 9.975 cabe con sus cuatro decimales", async () => {
      const grupo = await prisma.withTenantContext(tenantA, (tx) =>
        tx.taxGroup.findFirstOrThrow({ where: { tenantId: tenantA, code: "VAT16" } }),
      );
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.taxRate.create({
            data: {
              tenantId: tenantA,
              taxGroupId: grupo.id,
              code: "MAL",
              name: "Mal",
              rate: "100.0001",
            },
          }),
        ),
      ).rejects.toThrow();
      const qst = await prisma.withTenantContext(tenantA, (tx) =>
        tx.taxRate.create({
          data: {
            tenantId: tenantA,
            taxGroupId: grupo.id,
            code: "QST",
            name: "QST 9.975%",
            rate: "9.975",
          },
        }),
      );
      expect(qst.rate.toString()).toBe("9.975");
    });

    it("un modo fuera del catálogo rebota en el negocio; venta y cotización llevan el mismo CHECK", async () => {
      await expect(
        prisma.tenant.update({ where: { id: tenantA }, data: { taxMode: "gross" } }),
      ).rejects.toThrow();
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantA } })).taxMode).toBe(
        "included",
      );
      const checks = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
         WHERE conname IN ('sales_tax_mode_check', 'quotes_tax_mode_check', 'tenants_tax_mode_check')
         ORDER BY conname`;
      expect(checks.map((c) => c.conname)).toEqual([
        "quotes_tax_mode_check",
        "sales_tax_mode_check",
        "tenants_tax_mode_check",
      ]);
    });

    it("un código de grupo en minúsculas o con espacios rebota", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.taxGroup.create({ data: { tenantId: tenantA, code: "iva 16", name: "IVA" } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("el artículo y su grupo", () => {
    it("un grupo con artículos no se borra (RESTRICT); la FK NO frena un artículo de otro negocio", async () => {
      const grupo = await prisma.withTenantContext(tenantA, (tx) =>
        tx.taxGroup.findFirstOrThrow({ where: { tenantId: tenantA, code: "EXEMPT" } }),
      );
      await prisma.withTenantContext(tenantA, (tx) =>
        tx.service.create({
          data: { tenantId: tenantA, code: `SRV-${stamp}`, name: "Consulta", taxGroupId: grupo.id },
        }),
      );
      await expect(
        prisma.withTenantContext(tenantA, (tx) => tx.taxGroup.delete({ where: { id: grupo.id } })),
      ).rejects.toThrow();
      // OJO: la base NO frena que un artículo de B apunte a un grupo de A. La
      // comprobación de una FK corre con los privilegios del dueño de la tabla
      // y la RLS no la alcanza. Quien lo frena es el DTO (422
      // `catalogs.tax_group_unknown`, F4-TAX-10); este assert deja escrito por
      // qué esa validación no es opcional.
      await expect(
        prisma.withTenantContext(tenantB, (tx) =>
          tx.service.create({
            data: {
              tenantId: tenantB,
              code: `SRV-B-${stamp}`,
              name: "Consulta",
              taxGroupId: grupo.id,
            },
          }),
        ),
      ).resolves.toMatchObject({ taxGroupId: grupo.id });
    });
  });
});
