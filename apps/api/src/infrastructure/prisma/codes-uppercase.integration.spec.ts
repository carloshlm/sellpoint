import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const MIGRATION = join(
  __dirname,
  "../../../prisma/migrations/20260923100000_f9_suppcat_codes_uppercase/migration.sql",
);

/**
 * Integration (Postgres real) — F9-SUPPCAT-02: los códigos que ya existen
 * suben a MAYÚSCULAS, y una colisión (`kg` y `KG` en el mismo catálogo) se
 * resuelve con sufijo `-2` en la fila más nueva y un renglón de auditoría
 * (regla aprobada por Carlos, 2026-09-12). La migración se reproduce
 * sentencia por sentencia con el rol admin (salta RLS), como el backfill de
 * impuestos. Los datos se siembran DIRECTO con Prisma —sin pasar por el DTO,
 * que desde SUPPCAT-01 ya normaliza— para tener minúsculas de verdad.
 */
describe("los códigos existentes suben a mayúsculas (F9-SUPPCAT-02)", () => {
  let admin: PrismaClient;
  const stamp = Date.now();
  const sql = readFileSync(MIGRATION, "utf8");
  const sentencias = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.startsWith("--")));
  let tenantId: string;
  let catalogId: string;

  const replay = async () => {
    for (const sentencia of sentencias) {
      await admin.$executeRawUnsafe(sentencia);
    }
  };

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL_ADMIN para replayar la migración");
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    tenantId = (await admin.tenant.create({ data: { name: `Códigos ${stamp}` } })).id;
    catalogId = (
      await admin.catalog.create({ data: { tenantId, name: "Unidades", isSystem: false } })
    ).id;
    // `kg` primero, `KG` después: la MÁS NUEVA es la que recibe el sufijo.
    await admin.catalogRecord.create({ data: { tenantId, catalogId, code: "kg", attributes: {} } });
    await admin.catalogRecord.create({ data: { tenantId, catalogId, code: "KG", attributes: {} } });
    await admin.catalogRecord.create({ data: { tenantId, catalogId, code: "lt", attributes: {} } });
    await admin.product.create({
      data: { tenantId, sku: "abc.1/a", name: "En minúsculas", baseUnit: "unit" },
    });
    await admin.service.create({ data: { tenantId, code: "corte", name: "Corte" } });
  });

  afterAll(async () => {
    await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await admin.$disconnect();
  });

  it("la migración es SQL de conjunto: ninguna sentencia es un bloque DO", () => {
    expect(sql).not.toMatch(/DO \$\$/);
    expect(sentencias.length).toBeGreaterThanOrEqual(12);
  });

  it("sube lo que estaba en minúsculas y resuelve la colisión con sufijo -2 y auditoría", async () => {
    await replay();

    const registros = await admin.catalogRecord.findMany({
      where: { catalogId },
      orderBy: { createdAt: "asc" },
      select: { code: true },
    });
    expect(registros.map((r) => r.code)).toEqual(["KG", "KG-2", "LT"]);

    const producto = await admin.product.findFirst({ where: { tenantId }, select: { sku: true } });
    expect(producto?.sku).toBe("ABC.1/A");
    const servicio = await admin.service.findFirst({ where: { tenantId }, select: { code: true } });
    expect(servicio?.code).toBe("CORTE");

    const auditoria = await admin.auditLog.findMany({
      where: { tenantId, action: "catalogs.code_uppercased" },
    });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      resourceType: "catalog_record",
      before: { code: "KG" },
      after: { code: "KG-2" },
    });
  });

  it("es idempotente: la segunda corrida no renombra nada más", async () => {
    await replay();
    const registros = await admin.catalogRecord.findMany({
      where: { catalogId },
      orderBy: { createdAt: "asc" },
      select: { code: true },
    });
    expect(registros.map((r) => r.code)).toEqual(["KG", "KG-2", "LT"]);
    expect(
      await admin.auditLog.count({ where: { tenantId, action: "catalogs.code_uppercased" } }),
    ).toBe(1);
  });
});
