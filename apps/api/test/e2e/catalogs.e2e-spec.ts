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
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * e2e del motor de catálogos (F2-CAT). Registra tenants REALES por el flujo
 * público, igual que el resto de la suite — sin fixtures que se salteen la
 * lógica que se quiere probar.
 */
describe("Motor de catálogos (F2-CAT)", () => {
  /**
   * La paginación de registros (Carlos, 2026-08-25): el listado traía TODO el
   * subcatálogo de un tirón. El picker de lookups es OTRO endpoint (`options`,
   * con búsqueda y tope propio) y no se toca: un select necesita opciones, no
   * páginas.
   */
  describe("la paginación de registros (2026-08-25)", () => {
    it("pagina a 20 por defecto y reparte sin repetir", async () => {
      const { token } = await registerAndLogin();
      const catalogo = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: "Proveedores paginados" })
        .expect(201);
      const catalogId = (catalogo.body as { id: string }).id;

      for (let i = 0; i < 25; i += 1) {
        await request(app.getHttpServer())
          .post(`/catalogs/${catalogId}/records`)
          .set("Authorization", bearer(token))
          .send({ code: `PRV${String(i).padStart(3, "0")}`, attributes: {} })
          .expect(201);
      }

      const primera = await request(app.getHttpServer())
        .get(`/catalogs/${catalogId}/records`)
        .set("Authorization", bearer(token))
        .expect(200);
      const segunda = await request(app.getHttpServer())
        .get(`/catalogs/${catalogId}/records?page=2`)
        .set("Authorization", bearer(token))
        .expect(200);

      const p1 = primera.body as { rows: { code: string }[]; total: number; pageSize: number };
      const p2 = segunda.body as { rows: { code: string }[] };
      expect(p1.total).toBe(25);
      expect(p1.rows).toHaveLength(20);
      expect(p2.rows).toHaveLength(5);
      expect(new Set([...p1.rows, ...p2.rows].map((r) => r.code)).size).toBe(25);
    });
  });

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
    await startTestApp(app);
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

  /** Tenant verificado + logueado: devuelve su access token real. */
  async function registerAndLogin(): Promise<{ tenantId: string; token: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant catálogo ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);

    return {
      tenantId: (response.body as { tenantId: string }).tenantId,
      token: (login.body as { accessToken: string }).accessToken,
    };
  }

  function bearer(token: string) {
    return `Bearer ${token}`;
  }

  describe("F2-CAT-01 — Catálogo de Productos del sistema", () => {
    it("un tenant recién registrado ya tiene su Catálogo de Productos", async () => {
      const { tenantId } = await registerTenant();

      const catalogs = await prisma.withTenantContext(tenantId, (tx) => tx.catalog.findMany());

      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({ systemKey: PRODUCTS_CATALOG_KEY, isSystem: true });
    });

    it("cada tenant tiene el SUYO: el catálogo no se comparte entre negocios", async () => {
      // Secuencial a propósito: la suite corre con `maxWorkers: 1` y el
      // servidor efímero de supertest da ECONNRESET con flujos de registro
      // concurrentes. La concurrencia acá no prueba nada extra.
      const first = await registerTenant();
      const second = await registerTenant();

      const firstCatalogs = await prisma.withTenantContext(first.tenantId, (tx) =>
        tx.catalog.findMany(),
      );
      const secondCatalogs = await prisma.withTenantContext(second.tenantId, (tx) =>
        tx.catalog.findMany(),
      );

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

  describe("F2-CAT-02 — CRUD de catálogos", () => {
    it("GET /catalogs devuelve el del sistema primero", async () => {
      const { token } = await registerAndLogin();

      await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: "Aaa primero alfabeticamente" })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(token))
        .expect(200);

      const catalogs = response.body as { isSystem: boolean; name: string }[];
      expect(catalogs).toHaveLength(2);
      // Aunque el subcatálogo gane por nombre, el del sistema va primero: es
      // el que el usuario viene a editar el 90% de las veces.
      expect(catalogs[0]?.isSystem).toBe(true);
    });

    it("crea un subcatálogo y lo renombra", async () => {
      const { token } = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: "Unidades de medida" })
        .expect(201);

      const { id } = created.body as { id: string };
      expect(created.body).toMatchObject({ isSystem: false, systemKey: null, isActive: true });

      const renamed = await request(app.getHttpServer())
        .patch(`/catalogs/${id}`)
        .set("Authorization", bearer(token))
        .send({ name: "Unidades" })
        .expect(200);

      expect(renamed.body).toMatchObject({ name: "Unidades" });
    });

    it("nombre repetido dentro del tenant → 409", async () => {
      const { token } = await registerAndLogin();
      const payload = { name: `Proveedores ${randomUUID()}` };

      await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send(payload)
        .expect(201);

      await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send(payload)
        .expect(409);
    });

    it("el catálogo del sistema NO se renombra ni se archiva → 409", async () => {
      const { token } = await registerAndLogin();
      const list = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(token))
        .expect(200);
      const system = (list.body as { id: string; isSystem: boolean }[]).find((c) => c.isSystem);

      await request(app.getHttpServer())
        .patch(`/catalogs/${system?.id}`)
        .set("Authorization", bearer(token))
        .send({ name: "Mis cosas" })
        .expect(409);

      await request(app.getHttpServer())
        .patch(`/catalogs/${system?.id}`)
        .set("Authorization", bearer(token))
        .send({ isActive: false })
        .expect(409);
    });

    it("un tenant NO ve ni toca los catálogos de otro", async () => {
      const first = await registerAndLogin();
      const second = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(first.token))
        .send({ name: `Privado ${randomUUID()}` })
        .expect(201);
      const { id } = created.body as { id: string };

      // El de B solo ve SU catálogo del sistema.
      const listB = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(second.token))
        .expect(200);
      expect(listB.body).toHaveLength(1);

      // Y tocar el de A por id es 404, no 403: no se confirma que exista.
      await request(app.getHttpServer())
        .patch(`/catalogs/${id}`)
        .set("Authorization", bearer(second.token))
        .send({ name: "Robado" })
        .expect(404);
    });

    it("sin autenticación no se llega al motor", async () => {
      await request(app.getHttpServer()).get("/catalogs").expect(401);
    });
  });

  it("un Viewer LEE los catálogos pero no puede crear ni modificar (403)", async () => {
    // El gate declarativo es una línea por endpoint: `catalogs:read` para
    // leer, `catalogs:manage` para tocar la estructura. Poner el code
    // equivocado en un @RequirePermissions no rompe ningún otro test.
    const owner = await registerAndLogin();

    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.token))
      .expect(200);
    const viewerRoleId = (roles.body as { id: string; name: string }[]).find(
      (role) => role.name === "Viewer",
    )?.id;

    const email = `viewer-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.token))
      .send({ email, firstName: "Bruno", lastNamePaternal: "Díaz", roleIds: [viewerRoleId] })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const inviteToken = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: inviteToken, password: OWNER_PASSWORD })
      .expect(204);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);
    const viewerToken = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get("/catalogs")
      .set("Authorization", bearer(viewerToken))
      .expect(200);

    await request(app.getHttpServer())
      .post("/catalogs")
      .set("Authorization", bearer(viewerToken))
      .send({ name: "No deberia poder" })
      .expect(403);
  });

  describe("F2-CAT-03 — campos con guardas", () => {
    async function setup() {
      const { token, tenantId } = await registerAndLogin();
      const created = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: `Sub ${randomUUID()}` })
        .expect(201);
      // `tenantId` viene del registro y NO de consultar `catalogs`: sin
      // contexto de tenant la RLS devuelve 0 filas — que es justo lo que
      // queremos que haga.
      return { token, tenantId, catalogId: (created.body as { id: string }).id };
    }

    function addField(token: string, catalogId: string, body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .post(`/catalogs/${catalogId}/fields`)
        .set("Authorization", bearer(token))
        .send(body);
    }

    it("la key se deriva de la etiqueta y el usuario nunca la escribe", async () => {
      const { token, catalogId } = await setup();

      const response = await addField(token, catalogId, {
        label: "Origen del Grano",
        fieldType: "text",
      }).expect(201);

      expect(response.body).toMatchObject({ key: "origen_del_grano", position: 0 });
    });

    it("dos etiquetas que un humano lee igual chocan en la misma key → 409", async () => {
      const { token, catalogId } = await setup();
      await addField(token, catalogId, { label: "Color", fieldType: "text" }).expect(201);

      await addField(token, catalogId, { label: "COLOR", fieldType: "text" }).expect(409);
    });

    it("un lookup hacia un catálogo ajeno o archivado se rechaza", async () => {
      const { token, catalogId } = await setup();
      const otro = await registerAndLogin();
      const ajeno = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(otro.token))
        .send({ name: `Ajeno ${randomUUID()}` })
        .expect(201);

      await addField(token, catalogId, {
        label: "Proveedor",
        fieldType: "lookup",
        lookupCatalogId: (ajeno.body as { id: string }).id,
      }).expect(409);
    });

    it("quitar un campo SIN datos lo borra de verdad y libera la key", async () => {
      const { token, catalogId } = await setup();
      const field = await addField(token, catalogId, {
        label: "Temporal",
        fieldType: "text",
      }).expect(201);

      const removed = await request(app.getHttpServer())
        .delete(`/catalogs/${catalogId}/fields/${(field.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect(removed.body).toMatchObject({ archived: false });

      // La key vuelve a estar libre: nada quedó ocupándola.
      await addField(token, catalogId, { label: "Temporal", fieldType: "text" }).expect(201);
    });

    it("quitar un campo CON datos exige confirmación y NO borra los valores", async () => {
      const { token, tenantId, catalogId } = await setup();
      const field = await addField(token, catalogId, {
        label: "Medida",
        fieldType: "text",
      }).expect(201);
      const fieldId = (field.body as { id: string }).id;

      // Un registro que usa el campo. (F2-CAT-05 le pone endpoint; acá se
      // siembra directo porque lo que se prueba es la guarda, no el alta.)
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.catalogRecord.create({
          data: {
            tenantId,
            catalogId,
            code: `kg-${randomUUID()}`,
            attributes: { medida: "kilogramos" },
          },
        }),
      );

      // Sin confirmar: 409 con el CONTEO que la UI necesita para el diálogo.
      const blocked = await request(app.getHttpServer())
        .delete(`/catalogs/${catalogId}/fields/${fieldId}`)
        .set("Authorization", bearer(token))
        .expect(409);
      expect(blocked.body).toMatchObject({ requiresConfirmation: true, recordCount: 1 });

      // Confirmando: se ARCHIVA, no se borra.
      const archived = await request(app.getHttpServer())
        .delete(`/catalogs/${catalogId}/fields/${fieldId}?confirm=true`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect(archived.body).toMatchObject({ archived: true });

      // Y el VALOR sigue ahí: restaurar el campo lo devuelve entero.
      const records = await prisma.withTenantContext(tenantId, (tx) =>
        tx.catalogRecord.findMany({ where: { catalogId } }),
      );
      expect(records[0]?.attributes).toMatchObject({ medida: "kilogramos" });

      const restored = await request(app.getHttpServer())
        .patch(`/catalogs/${catalogId}/fields/${fieldId}`)
        .set("Authorization", bearer(token))
        .send({ isArchived: false })
        .expect(200);
      expect(restored.body).toMatchObject({ isArchived: false, key: "medida" });
    });

    it("cambiar el TIPO de un campo con datos → 409; sin datos se permite", async () => {
      const { token, tenantId, catalogId } = await setup();
      const sinDatos = await addField(token, catalogId, {
        label: "Sin datos",
        fieldType: "text",
      }).expect(201);

      await request(app.getHttpServer())
        .patch(`/catalogs/${catalogId}/fields/${(sinDatos.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .send({ fieldType: "number" })
        .expect(200);

      const conDatos = await addField(token, catalogId, {
        label: "Con datos",
        fieldType: "text",
      }).expect(201);
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.catalogRecord.create({
          data: {
            tenantId,
            catalogId,
            code: `c-${randomUUID()}`,
            attributes: { con_datos: "aproximadamente 3" },
          },
        }),
      );

      await request(app.getHttpServer())
        .patch(`/catalogs/${catalogId}/fields/${(conDatos.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .send({ fieldType: "number" })
        .expect(409);
    });

    it("renombrar la etiqueta NO mueve la key: los datos no se tocan", async () => {
      const { token, catalogId } = await setup();
      const field = await addField(token, catalogId, {
        label: "Sustancia Activa",
        fieldType: "text",
      }).expect(201);

      const renamed = await request(app.getHttpServer())
        .patch(`/catalogs/${catalogId}/fields/${(field.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .send({ label: "Principio activo" })
        .expect(200);

      expect(renamed.body).toMatchObject({ label: "Principio activo", key: "sustancia_activa" });
    });
  });

  describe("F2-CAT-05/06 — registros y lookups", () => {
    /**
     * El ejemplo de Carlos, de punta a punta: un catálogo "Unidad de Medida"
     * con Código + un campo personalizado, y otro catálogo que lo referencia
     * por lookup.
     */
    async function setupUnidades() {
      const { token, tenantId } = await registerAndLogin();

      const unidades = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: `Unidad de Medida ${randomUUID()}` })
        .expect(201);
      const unidadesId = (unidades.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/catalogs/${unidadesId}/fields`)
        .set("Authorization", bearer(token))
        .send({ label: "Medida", fieldType: "text", required: true })
        .expect(201);

      const kg = await request(app.getHttpServer())
        .post(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "kg", attributes: { medida: "kilogramos" } })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "lt", attributes: { medida: "litros" } })
        .expect(201);

      return { token, tenantId, unidadesId, kgId: (kg.body as { id: string }).id };
    }

    it("carga registros con su Código y su campo personalizado", async () => {
      const { token, unidadesId } = await setupUnidades();

      const list = await request(app.getHttpServer())
        .get(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .expect(200);

      const records = (
        list.body as { rows: { code: string; attributes: Record<string, string> }[] }
      ).rows;
      expect(records.map((r) => r.code)).toEqual(["kg", "lt"]);
      expect(records[0]?.attributes).toMatchObject({ medida: "kilogramos" });
    });

    it("el Código no se repite DENTRO del catálogo (409) pero sí entre catálogos", async () => {
      const { token, unidadesId } = await setupUnidades();

      await request(app.getHttpServer())
        .post(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "kg", attributes: { medida: "otra cosa" } })
        .expect(409);

      const otro = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: `Otro ${randomUUID()}` })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/catalogs/${(otro.body as { id: string }).id}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "kg" })
        .expect(201);
    });

    it("un requerido vacío o de tipo equivocado se rechaza con el error POR CAMPO", async () => {
      const { token, unidadesId } = await setupUnidades();

      const missing = await request(app.getHttpServer())
        .post(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "gr" })
        .expect(400);
      expect(missing.body).toMatchObject({
        errors: [{ key: "medida", code: "catalogs.field_required" }],
      });

      const wrongType = await request(app.getHttpServer())
        .post(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "gr", attributes: { medida: 42 } })
        .expect(400);
      expect(wrongType.body).toMatchObject({
        errors: [{ key: "medida", code: "catalogs.field_must_be_text" }],
      });
    });

    it("una clave que no es de ningún campo no entra al JSONB", async () => {
      const { token, unidadesId } = await setupUnidades();

      await request(app.getHttpServer())
        .post(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "gr", attributes: { medida: "gramos", colado: "x" } })
        .expect(400);
    });

    it("un lookup guarda el id del destino y solo acepta uno que EXISTA", async () => {
      const { token, unidadesId, kgId } = await setupUnidades();

      const productos = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: `Insumos ${randomUUID()}` })
        .expect(201);
      const insumosId = (productos.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/catalogs/${insumosId}/fields`)
        .set("Authorization", bearer(token))
        .send({ label: "Unidad", fieldType: "lookup", lookupCatalogId: unidadesId })
        .expect(201);

      // Con el id real: entra.
      await request(app.getHttpServer())
        .post(`/catalogs/${insumosId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "azucar", attributes: { unidad: kgId } })
        .expect(201);

      // Con un UUID que no existe: la DB no puede frenarlo (es un id dentro
      // de un JSONB), así que lo frena el service.
      const orphan = await request(app.getHttpServer())
        .post(`/catalogs/${insumosId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "cafe", attributes: { unidad: randomUUID() } })
        .expect(400);
      expect(orphan.body).toMatchObject({
        errors: [{ key: "unidad", code: "catalogs.lookup_value_not_found" }],
      });
    });

    it("archivar un registro REFERENCIADO por un lookup se bloquea, diciendo quién lo usa", async () => {
      const { token, unidadesId, kgId } = await setupUnidades();
      const insumos = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: `Insumos ref ${randomUUID()}` })
        .expect(201);
      const insumosId = (insumos.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/catalogs/${insumosId}/fields`)
        .set("Authorization", bearer(token))
        .send({ label: "Unidad", fieldType: "lookup", lookupCatalogId: unidadesId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/catalogs/${insumosId}/records`)
        .set("Authorization", bearer(token))
        .send({ code: "azucar", attributes: { unidad: kgId } })
        .expect(201);

      const blocked = await request(app.getHttpServer())
        .patch(`/catalogs/${unidadesId}/records/${kgId}`)
        .set("Authorization", bearer(token))
        .send({ isActive: false })
        .expect(409);
      expect(blocked.body).toMatchObject({
        code: "catalogs.record_referenced",
      });
    });

    /**
     * Eliminar un registro (Carlos, 2026-08-25). El mismo guard que archivar
     * (`assertNotReferenced`): un registro al que alguien apunta por lookup no
     * se borra ni se esconde — primero hay que soltar la referencia. Uno libre
     * sí se borra de verdad: un typo en un subcatálogo no merece quedarse
     * eternamente como "inactivo".
     */
    describe("DELETE de un registro (2026-08-25)", () => {
      it("un registro libre se elimina y desaparece del listado", async () => {
        const { token, unidadesId, kgId } = await setupUnidades();

        await request(app.getHttpServer())
          .delete(`/catalogs/${unidadesId}/records/${kgId}`)
          .set("Authorization", bearer(token))
          .expect(204);

        const list = await request(app.getHttpServer())
          .get(`/catalogs/${unidadesId}/records`)
          .set("Authorization", bearer(token))
          .expect(200);
        const rows = (list.body as { rows: { id: string }[] }).rows;
        expect(rows.some((r) => r.id === kgId)).toBe(false);
      });

      it("uno REFERENCIADO por un lookup -> 409, el mismo guard que archivar", async () => {
        const { token, unidadesId, kgId } = await setupUnidades();
        const insumos = await request(app.getHttpServer())
          .post("/catalogs")
          .set("Authorization", bearer(token))
          .send({ name: `Insumos del ${randomUUID()}` })
          .expect(201);
        const insumosId = (insumos.body as { id: string }).id;

        await request(app.getHttpServer())
          .post(`/catalogs/${insumosId}/fields`)
          .set("Authorization", bearer(token))
          .send({ label: "Unidad", fieldType: "lookup", lookupCatalogId: unidadesId })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/catalogs/${insumosId}/records`)
          .set("Authorization", bearer(token))
          .send({ code: "azucar", attributes: { unidad: kgId } })
          .expect(201);

        const blocked = await request(app.getHttpServer())
          .delete(`/catalogs/${unidadesId}/records/${kgId}`)
          .set("Authorization", bearer(token))
          .expect(409);
        expect(blocked.body).toMatchObject({ code: "catalogs.record_referenced" });
      });
    });

    it("F2-CAT-06: el picker devuelve código + display y filtra por ambos", async () => {
      const { token, unidadesId } = await setupUnidades();

      const all = await request(app.getHttpServer())
        .get(`/catalogs/${unidadesId}/records/options`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect(all.body).toEqual([
        { id: expect.any(String), code: "kg", display: "kilogramos" },
        { id: expect.any(String), code: "lt", display: "litros" },
      ]);

      // Por código...
      const byCode = await request(app.getHttpServer())
        .get(`/catalogs/${unidadesId}/records/options?query=kg`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect(byCode.body).toHaveLength(1);

      // ...y por lo que el usuario LEE, que es lo que va a tipear.
      const byDisplay = await request(app.getHttpServer())
        .get(`/catalogs/${unidadesId}/records/options?query=litro`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect(byDisplay.body).toMatchObject([{ code: "lt" }]);
    });

    it("el picker no ofrece registros archivados", async () => {
      const { token, unidadesId } = await setupUnidades();
      const list = await request(app.getHttpServer())
        .get(`/catalogs/${unidadesId}/records`)
        .set("Authorization", bearer(token))
        .expect(200);
      const lt = (list.body as { rows: { id: string; code: string }[] }).rows.find(
        (r) => r.code === "lt",
      );

      await request(app.getHttpServer())
        .patch(`/catalogs/${unidadesId}/records/${lt?.id}`)
        .set("Authorization", bearer(token))
        .send({ isActive: false })
        .expect(200);

      const options = await request(app.getHttpServer())
        .get(`/catalogs/${unidadesId}/records/options`)
        .set("Authorization", bearer(token))
        .expect(200);
      expect(options.body).toMatchObject([{ code: "kg" }]);
    });
  });
});
