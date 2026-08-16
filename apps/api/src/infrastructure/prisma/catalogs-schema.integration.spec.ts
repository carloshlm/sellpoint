import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F2-DB-02: `catalogs` y
 * `catalog_fields`, las dos primeras tablas del motor de catálogos.
 *
 * Se testean las INVARIANTES que Prisma no puede expresar y que, si faltaran,
 * fallarían en silencio hasta producción:
 *
 * 1. Un solo catálogo del sistema por clave y tenant (índice único PARCIAL).
 * 2. Un campo lookup siempre apunta a un catálogo, y uno que no es lookup
 *    nunca arrastra destino (CHECK bidireccional).
 * 3. Borrar el catálogo destino de un lookup está bloqueado por FK RESTRICT
 *    — el default de Prisma para relaciones opcionales es SET NULL, que dejaría
 *    un estado que el CHECK prohíbe.
 *
 * NO se testea que Prisma sepa insertar filas: eso es el ORM, no nuestra
 * decisión (criterio de CONTRIBUTING).
 */
describe("catalogs / catalog_fields — invariantes de schema (F2-DB-02)", () => {
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const tenant = await prisma.tenant.create({ data: { name: `Tenant catalogs ${Date.now()}` } });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function createCatalog(name: string, systemKey?: string) {
    return prisma.withTenantContext(tenantId, (tx) =>
      tx.catalog.create({
        data: {
          tenantId,
          name,
          systemKey: systemKey ?? null,
          isSystem: systemKey !== undefined,
        },
      }),
    );
  }

  it("un tenant no puede tener dos catálogos con la misma system_key", async () => {
    await createCatalog(`Productos ${Date.now()}`, "products");

    await expect(createCatalog(`Productos duplicado ${Date.now()}`, "products")).rejects.toThrow();
  });

  it("varios subcatálogos conviven: system_key NULL no colisiona consigo mismo", async () => {
    const first = await createCatalog(`Unidad de medida ${Date.now()}`);
    const second = await createCatalog(`Laboratorios ${Date.now()}`);

    expect(first.systemKey).toBeNull();
    expect(second.systemKey).toBeNull();
  });

  it("un campo lookup SIN catálogo destino es rechazado por el CHECK", async () => {
    const catalog = await createCatalog(`Con lookup roto ${Date.now()}`);

    await expect(
      prisma.withTenantContext(tenantId, (tx) =>
        tx.catalogField.create({
          data: {
            tenantId,
            catalogId: catalog.id,
            key: "proveedor",
            label: "Proveedor",
            fieldType: "lookup",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("un campo de texto CON catálogo destino es rechazado por el CHECK", async () => {
    const catalog = await createCatalog(`Con texto colgado ${Date.now()}`);
    const target = await createCatalog(`Destino ${Date.now()}`);

    await expect(
      prisma.withTenantContext(tenantId, (tx) =>
        tx.catalogField.create({
          data: {
            tenantId,
            catalogId: catalog.id,
            key: "notas",
            label: "Notas",
            fieldType: "text",
            lookupCatalogId: target.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("un campo lookup CON destino se crea sin problemas (el CHECK no es un muro ciego)", async () => {
    const catalog = await createCatalog(`Origen ${Date.now()}`);
    const target = await createCatalog(`Destino valido ${Date.now()}`);

    const field = await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogField.create({
        data: {
          tenantId,
          catalogId: catalog.id,
          key: "unidad",
          label: "Unidad",
          fieldType: "lookup",
          lookupCatalogId: target.id,
          required: true,
        },
      }),
    );

    expect(field.lookupCatalogId).toBe(target.id);
  });

  it("borrar el catálogo destino de un lookup está bloqueado por FK RESTRICT", async () => {
    const catalog = await createCatalog(`Origen restrict ${Date.now()}`);
    const target = await createCatalog(`Destino restrict ${Date.now()}`);
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogField.create({
        data: {
          tenantId,
          catalogId: catalog.id,
          key: "referencia",
          label: "Referencia",
          fieldType: "lookup",
          lookupCatalogId: target.id,
        },
      }),
    );

    await expect(
      prisma.withTenantContext(tenantId, (tx) => tx.catalog.delete({ where: { id: target.id } })),
    ).rejects.toThrow();
  });

  it("la key de un campo es única dentro del catálogo, no entre catálogos", async () => {
    const first = await createCatalog(`Catalogo A ${Date.now()}`);
    const second = await createCatalog(`Catalogo B ${Date.now()}`);
    const field = { key: "codigo_interno", label: "Código interno", fieldType: "text" as const };

    await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogField.create({ data: { tenantId, catalogId: first.id, ...field } }),
    );
    // Misma key en OTRO catálogo: permitido.
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogField.create({ data: { tenantId, catalogId: second.id, ...field } }),
    );

    // Misma key en el MISMO catálogo: rechazado.
    await expect(
      prisma.withTenantContext(tenantId, (tx) =>
        tx.catalogField.create({ data: { tenantId, catalogId: first.id, ...field } }),
      ),
    ).rejects.toThrow();
  });
});

/**
 * F2-DB-03: `catalog_records`, las filas de los subcatálogos. El campo estándar
 * `code` ("Código / Nombre Corto") es el que el cliente define y el que los
 * lookups muestran, así que su unicidad POR CATÁLOGO es la invariante central:
 * dos catálogos distintos pueden tener ambos un `kg`, el mismo no.
 */
describe("catalog_records — código único y GIN (F2-DB-03)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let catalogAId: string;
  let catalogBId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const tenant = await prisma.tenant.create({ data: { name: `Tenant records ${Date.now()}` } });
    tenantId = tenant.id;

    const [catalogA, catalogB] = await prisma.withTenantContext(tenantId, async (tx) => [
      await tx.catalog.create({ data: { tenantId, name: `Unidades ${Date.now()}` } }),
      await tx.catalog.create({ data: { tenantId, name: `Proveedores ${Date.now()}` } }),
    ]);
    catalogAId = catalogA.id;
    catalogBId = catalogB.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("el mismo código en dos catálogos distintos convive; repetido en uno se rechaza", async () => {
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogRecord.create({
        data: { tenantId, catalogId: catalogAId, code: "kg", attributes: { medida: "kilogramos" } },
      }),
    );
    // Mismo código, OTRO catálogo: permitido.
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogRecord.create({ data: { tenantId, catalogId: catalogBId, code: "kg" } }),
    );

    await expect(
      prisma.withTenantContext(tenantId, (tx) =>
        tx.catalogRecord.create({ data: { tenantId, catalogId: catalogAId, code: "kg" } }),
      ),
    ).rejects.toThrow();
  });

  it("la búsqueda por lookup inverso usa el índice GIN, no un seq scan", async () => {
    // UUID único por corrida y filtro por catálogo: hasta F2-DB-09 estas tablas
    // NO tienen RLS, así que una constante fija acumularía las filas de todas
    // las corridas anteriores y el conteo mentiría.
    const referencedId = randomUUID();
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogRecord.create({
        data: {
          tenantId,
          catalogId: catalogBId,
          code: `ref-${Date.now()}`,
          attributes: { unidad: referencedId },
        },
      }),
    );

    // Se afirma que el índice EXISTE y es GIN sobre attributes: el plan de
    // ejecución con pocas filas elige seq scan igual, así que medirlo con
    // EXPLAIN daría un falso negativo en un entorno de test.
    const [index] = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes
      WHERE tablename = 'catalog_records' AND indexname = 'catalog_records_attributes_idx'`;

    expect(index?.indexdef).toContain("gin");
    expect(index?.indexdef).toContain("attributes");

    const found = await prisma.withTenantContext(tenantId, (tx) =>
      tx.catalogRecord.findMany({
        where: { attributes: { path: ["unidad"], equals: referencedId } },
      }),
    );
    expect(found).toHaveLength(1);
  });
});
