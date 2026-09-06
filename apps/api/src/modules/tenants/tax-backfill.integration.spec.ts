import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildTaxBackfillSql } from "../../../prisma/tax-backfill-sql";
import type { Env } from "../../config/env.schema";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

const MIGRATION = join(
  __dirname,
  "../../../prisma/migrations/20260910110000_f4_taxes_backfill/migration.sql",
);

/**
 * Integration (Postgres real) — F4-TAX-05: el backfill de impuestos para los
 * negocios que ya existían.
 *
 * México recibe IVA 16% incluido (el precio no cambia, el ticket empieza a
 * desglosar); Canadá, sin provincia, solo lo federal; Estados Unidos, sin
 * impuesto; el resto curado su IVA; sin país, nada. Idempotente. Y el
 * archivo de la migración es EXACTAMENTE lo que emite el generador desde
 * shared: si `resolveTaxDefaults` cambia, este spec avisa antes que
 * producción.
 */
describe("backfill de impuestos para los negocios existentes (F4-TAX-05)", () => {
  let prisma: PrismaService;
  /** La migración corre con el rol ADMIN (DATABASE_URL_ADMIN): salta RLS. */
  let admin: PrismaClient;
  const stamp = Date.now();
  const sql = readFileSync(MIGRATION, "utf8");
  const sentencias = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.startsWith("--")));
  const tenants: Record<string, string> = {};

  const replay = async () => {
    for (const sentencia of sentencias) {
      await admin.$executeRawUnsafe(sentencia);
    }
  };
  const grupos = (tenantId: string) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.taxGroup.findMany({
        where: { tenantId },
        orderBy: { sortOrder: "asc" },
        include: { rates: { orderBy: { sortOrder: "asc" } } },
      }),
    );

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("Falta DATABASE_URL_ADMIN para replayar la migración");
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
    for (const [clave, country] of Object.entries({
      MX: "MX",
      CA: "CA",
      US: "US",
      ES: "ES",
      JP: "JP",
    })) {
      tenants[clave] = (
        await prisma.tenant.create({ data: { name: `Backfill ${clave} ${stamp}`, country } })
      ).id;
    }
    tenants.SIN_PAIS = (
      await prisma.tenant.create({ data: { name: `Backfill sin país ${stamp}` } })
    ).id;
    // Un negocio que YA configuró lo suyo: el backfill no lo toca.
    tenants.CONFIGURADO = (
      await prisma.tenant.create({
        data: { name: `Backfill config ${stamp}`, country: "MX", taxMode: "excluded" },
      })
    ).id;
    await prisma.withTenantContext(tenants.CONFIGURADO, (tx) =>
      tx.taxGroup.create({
        data: {
          tenantId: tenants.CONFIGURADO as string,
          code: "MIO",
          name: "El mío",
          isDefault: true,
        },
      }),
    );
  });

  afterAll(async () => {
    await admin.$disconnect();
    await prisma.onModuleDestroy();
  });

  it("el archivo de la migración es exactamente lo que emite el generador desde shared", () => {
    expect(sql).toBe(buildTaxBackfillSql());
  });

  it("México: IVA 16% incluido como default, con 8%, 0% y exento al lado", async () => {
    await replay();
    const mx = await grupos(tenants.MX as string);
    expect(mx.map((g) => [g.code, g.isDefault])).toEqual([
      ["VAT16", true],
      ["VAT8", false],
      ["VAT0", false],
      ["EXEMPT", false],
    ]);
    expect(mx[0]?.rates.map((r) => [r.code, r.rate.toString()])).toEqual([["VAT", "16"]]);
    expect(mx[3]?.rates).toEqual([]);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenants.MX as string } })).taxMode,
    ).toBe("included");
  });

  it("Canadá sin provincia: solo GST 5% y modo excluido; Estados Unidos: sin impuesto y excluido", async () => {
    const ca = await grupos(tenants.CA as string);
    expect(ca.find((g) => g.isDefault)?.code).toBe("GST_ONLY");
    expect(ca.find((g) => g.isDefault)?.rates.map((r) => r.rate.toString())).toEqual(["5"]);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenants.CA as string } })).taxMode,
    ).toBe("excluded");
    const us = await grupos(tenants.US as string);
    expect(us.find((g) => g.isDefault)?.code).toBe("NO_TAX");
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenants.US as string } })).taxMode,
    ).toBe("excluded");
  });

  it("España recibe su IVA 21%; un país no curado y un negocio sin país quedan sin impuesto", async () => {
    expect((await grupos(tenants.ES as string)).find((g) => g.isDefault)?.name).toBe("IVA 21%");
    for (const clave of ["JP", "SIN_PAIS"]) {
      const lista = await grupos(tenants[clave] as string);
      expect(lista.map((g) => [g.code, g.isDefault])).toEqual([["NO_TAX", true]]);
    }
  });

  it("no toca al negocio que ya configuró lo suyo, y correr dos veces no duplica nada", async () => {
    await replay();
    await replay();
    const propio = await grupos(tenants.CONFIGURADO as string);
    expect(propio.map((g) => g.code)).toEqual(["MIO"]);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenants.CONFIGURADO as string } }))
        .taxMode,
    ).toBe("excluded");
    expect(await grupos(tenants.MX as string)).toHaveLength(4);
    expect((await grupos(tenants.MX as string))[0]?.rates).toHaveLength(1);
  });
});
