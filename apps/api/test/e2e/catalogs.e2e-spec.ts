import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { PRODUCTS_CATALOG_KEY } from "../../src/modules/tenants/role-catalog";

/**
 * e2e del motor de catálogos (F2-CAT). Registra tenants REALES por el flujo
 * público, igual que el resto de la suite — sin fixtures que se salteen la
 * lógica que se quiere probar.
 */
describe("Motor de catálogos (F2-CAT)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerTenant(): Promise<{ tenantId: string; userId: string }> {
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant catálogo ${randomUUID()}`,
        email: `owner-${randomUUID()}@example.com`,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    return response.body as { tenantId: string; userId: string };
  }

  describe("F2-CAT-01 — Catálogo de Productos del sistema", () => {
    it("un tenant recién registrado ya tiene su Catálogo de Productos", async () => {
      const { tenantId } = await registerTenant();

      const catalogs = await prisma.withTenantContext(tenantId, (tx) => tx.catalog.findMany());

      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({ systemKey: PRODUCTS_CATALOG_KEY, isSystem: true });
    });

    it("cada tenant tiene el SUYO: el catálogo no se comparte entre negocios", async () => {
      const [first, second] = await Promise.all([registerTenant(), registerTenant()]);

      const [firstCatalogs, secondCatalogs] = await Promise.all([
        prisma.withTenantContext(first.tenantId, (tx) => tx.catalog.findMany()),
        prisma.withTenantContext(second.tenantId, (tx) => tx.catalog.findMany()),
      ]);

      expect(firstCatalogs).toHaveLength(1);
      expect(secondCatalogs).toHaveLength(1);
      expect(firstCatalogs[0]?.id).not.toBe(secondCatalogs[0]?.id);
    });

    it("el backfill le da catálogo a un tenant PRE-F2 y es idempotente", async () => {
      // Se replaya la migración de backfill como corre de verdad
      // (`prisma migrate deploy` con el superuser, que bypasea RLS — mismo
      // patrón que `tenants-me.e2e-spec.ts`). No se puede afirmar "ningún
      // tenant sin catálogo" globalmente: otras suites crean tenants crudos
      // con `prisma.tenant.create()`, salteándose `provision()` a propósito.
      const adminConnectionString = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
      if (!adminConnectionString) {
        throw new Error("Falta DATABASE_URL_ADMIN (o DATABASE_URL) para replayar la migración");
      }
      const adminPrisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: adminConnectionString }),
      });

      try {
        // Un tenant "viejo": creado sin pasar por provision(), como los que
        // existían antes de Fase 2.
        const legacy = await adminPrisma.tenant.create({
          data: { name: `Tenant pre-F2 ${randomUUID()}` },
        });

        const before = await adminPrisma.catalog.count({ where: { tenantId: legacy.id } });
        expect(before).toBe(0);

        const migrationSql = readFileSync(
          join(
            __dirname,
            "../../prisma/migrations/20260816212000_products_catalog_backfill/migration.sql",
          ),
          "utf-8",
        );
        const statements = migrationSql
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .split(";")
          .map((statement) => statement.trim())
          .filter((statement) => statement.length > 0);

        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }

        const after = await adminPrisma.catalog.findMany({ where: { tenantId: legacy.id } });
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({ systemKey: PRODUCTS_CATALOG_KEY, isSystem: true });

        // Segunda pasada: el NOT EXISTS no debe duplicar ni romper.
        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
        expect(await adminPrisma.catalog.count({ where: { tenantId: legacy.id } })).toBe(1);
      } finally {
        await adminPrisma.$disconnect();
      }
    });
  });
});
