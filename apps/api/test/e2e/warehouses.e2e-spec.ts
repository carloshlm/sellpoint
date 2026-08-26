import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/** F2-WH-01 — CRUD de almacenes con tenants reales. */
describe("Almacenes (F2-WH)", () => {
  let app: INestApplication<App>;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndLogin(): Promise<string> {
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant almacen ${randomUUID()}`,
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
    return (login.body as { accessToken: string }).accessToken;
  }

  const bearer = (token: string) => `Bearer ${token}`;

  it("crea, lista, edita y desactiva un almacén", async () => {
    const token = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Central", address: "Calle 1" })
      .expect(201);
    const { id } = created.body as { id: string };
    expect(created.body).toMatchObject({ name: "Central", isActive: true });

    await request(app.getHttpServer())
      .patch(`/warehouses/${id}`)
      .set("Authorization", bearer(token))
      .send({ isActive: false })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(token))
      .expect(200);
    // F3-HOME-03: el tenant NACE con «Almacén Central», así que la lista trae
    // dos — el inicial y este. Se busca el creado en vez de comparar la lista
    // entera: afirmar el largo ataría este test al onboarding.
    const creado = (list.body as { id: string; isActive: boolean }[]).find((w) => w.id === id);
    expect(creado).toMatchObject({ id, isActive: false });
  });

  /**
   * Eliminar un almacén (Carlos, 2026-08-25). La guarda es la de siempre en
   * la casa (products.has_movements, F3-GUARDS): con HISTORIA detrás no se
   * borra — el kardex y los folios lo referencian y el histórico no se
   * reescribe. La salida no destructiva es desactivarlo. Solo un almacén que
   * nunca operó (creado por error, un duplicado) se puede borrar de verdad.
   */
  describe("DELETE /warehouses/:id (2026-08-25)", () => {
    it("un almacén sin historia se elimina y desaparece del listado", async () => {
      const token = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: "Creado por error" })
        .expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .delete(`/warehouses/${id}`)
        .set("Authorization", bearer(token))
        .expect(204);

      const list = await request(app.getHttpServer())
        .get("/warehouses")
        .set("Authorization", bearer(token))
        .expect(200);
      expect((list.body as { id: string }[]).some((w) => w.id === id)).toBe(false);
    });

    it("con historia (aunque sea un borrador de documento) -> 409 y el almacén sigue", async () => {
      const token = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: "Con historia" })
        .expect(201);
      const id = (created.body as { id: string }).id;

      // Un borrador ya toma folio de la serie: es historia, no un borrón.
      await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "entry", warehouseId: id })
        .expect(201);

      const response = await request(app.getHttpServer())
        .delete(`/warehouses/${id}`)
        .set("Authorization", bearer(token))
        .expect(409);
      expect(response.body).toMatchObject({ code: "warehouses.has_history" });

      const list = await request(app.getHttpServer())
        .get("/warehouses")
        .set("Authorization", bearer(token))
        .expect(200);
      expect((list.body as { id: string }[]).some((w) => w.id === id)).toBe(true);
    });

    it("un id de otro tenant -> 404 (aislamiento, no filtración)", async () => {
      const tokenA = await registerAndLogin();
      const tokenB = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(tokenA))
        .send({ name: "Del tenant A" })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/warehouses/${(created.body as { id: string }).id}`)
        .set("Authorization", bearer(tokenB))
        .expect(404);
    });
  });

  it("la dirección es OPCIONAL: un almacén sin dirección es válido", async () => {
    // MERCADOS.md § 4: los formatos postales difieren entre los 26 mercados,
    // así que no se exige ni se estructura.
    const token = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Sin dirección" })
      .expect(201);

    expect(created.body).toMatchObject({ address: null });
  });

  /**
   * Contacto estándar + campos dinámicos (Carlos, 2026-08-26): el almacén
   * gana phone (E.164 canónico, mismo criterio que el tenant) y email, y su
   * `attributes` se valida contra el catálogo de sistema "warehouses".
   */
  describe("contacto y campos dinámicos (2026-08-26)", () => {
    it("crea con phone, email y attributes; el GET los devuelve", async () => {
      const token = await registerAndLogin();

      // Un campo dinámico real en el catálogo de almacenes del tenant.
      const list = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(token))
        .expect(200);
      const catalogId = (list.body as { id: string; systemKey: string | null }[]).find(
        (c) => c.systemKey === "warehouses",
      )?.id;
      await request(app.getHttpServer())
        .post(`/catalogs/${catalogId}/fields`)
        .set("Authorization", bearer(token))
        .send({ label: "Encargado", fieldType: "text", required: false })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({
          name: "Sucursal Centro",
          address: "Av. Juárez 10",
          phone: "+525512345678",
          email: "centro@negocio.mx",
          attributes: { encargado: "Rosa" },
        })
        .expect(201);
      expect(created.body).toMatchObject({
        phone: "+525512345678",
        email: "centro@negocio.mx",
        attributes: { encargado: "Rosa" },
      });

      const fetched = await request(app.getHttpServer())
        .get("/warehouses")
        .set("Authorization", bearer(token))
        .expect(200);
      const sucursal = (fetched.body as { name: string; phone: string | null }[]).find(
        (w) => w.name === "Sucursal Centro",
      );
      expect(sucursal).toMatchObject({ phone: "+525512345678", email: "centro@negocio.mx" });
    });

    it("un phone que no es E.164 canónico → 400 warehouses.invalid_phone", async () => {
      const token = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: "Tel malo", phone: "+52 55 1234" })
        .expect(400);
      expect(response.body).toMatchObject({ code: "warehouses.invalid_phone" });
    });

    it("un email inválido → 400 warehouses.invalid_email", async () => {
      const token = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: "Email malo", email: "no-es-email" })
        .expect(400);
      expect(response.body).toMatchObject({ code: "warehouses.invalid_email" });
    });

    it("attributes con una clave que no es de ningún campo → 400 con el error por campo", async () => {
      const token = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: "Atributos malos", attributes: { colado: "x" } })
        .expect(400);
      expect(response.body).toMatchObject({
        code: "warehouses.invalid_attributes",
        errors: [{ key: "colado", code: "catalogs.field_unknown" }],
      });
    });

    it("un campo dinámico requerido ausente → 400 catalogs.field_required", async () => {
      const token = await registerAndLogin();

      const list = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(token))
        .expect(200);
      const catalogId = (list.body as { id: string; systemKey: string | null }[]).find(
        (c) => c.systemKey === "warehouses",
      )?.id;
      await request(app.getHttpServer())
        .post(`/catalogs/${catalogId}/fields`)
        .set("Authorization", bearer(token))
        .send({ label: "Zona", fieldType: "text", required: true })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: "Sin zona", attributes: {} })
        .expect(400);
      expect(response.body).toMatchObject({
        errors: [{ key: "zona", code: "catalogs.field_required" }],
      });
    });

    it("PATCH con phone null lo limpia", async () => {
      const token = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: "Con tel", phone: "+525512345678" })
        .expect(201);

      const patched = await request(app.getHttpServer())
        .patch(`/warehouses/${(created.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .send({ phone: null })
        .expect(200);
      expect((patched.body as { phone: string | null }).phone).toBeNull();
    });
  });

  it("nombre repetido dentro del tenant → 409", async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Central" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Central" })
      .expect(409);
  });

  it("un tenant no ve ni toca los almacenes de otro", async () => {
    const first = await registerAndLogin();
    const second = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(first))
      .send({ name: "Privado" })
      .expect(201);

    const listB = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(second))
      .expect(200);
    // Ve el SUYO (el inicial de F3-HOME-03) y ninguno del otro tenant: eso es
    // justo lo que este test protege.
    const nombresB = (listB.body as { name: string }[]).map((w) => w.name);
    expect(nombresB).not.toContain("Privado");

    await request(app.getHttpServer())
      .patch(`/warehouses/${(created.body as { id: string }).id}`)
      .set("Authorization", bearer(second))
      .send({ name: "Robado" })
      .expect(404);
  });
  /**
   * F3-CORE-03 — `?scoped=true`, el primer consumidor real de
   * `@CurrentUserScope()`. Lo usan los selectores de almacén de toda la Fase 3:
   * un Manager no tiene que poder ni siquiera ELEGIR un almacén que no
   * administra.
   */
  describe("F3-CORE-03 — ?scoped=true", () => {
    it("sin el flag lista todos: el comportamiento de F2 queda intacto", async () => {
      const token = await registerAndLogin();
      await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Central ${randomUUID()}` })
        .expect(201);
      await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Sucursal ${randomUUID()}` })
        .expect(201);

      const all = await request(app.getHttpServer())
        .get("/warehouses")
        .set("Authorization", bearer(token))
        .expect(200);

      expect((all.body as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    /**
     * El Admin que registra el tenant no tiene filas de alcance, así que
     * su scope es `all` por el default permisivo de F2-SCOPE-01 — y con el flag
     * sigue viendo todos. Lo que el flag SÍ filtra siempre es lo inactivo:
     * contra un almacén desactivado no se puede mover stock.
     */
    it("con el flag esconde los almacenes DESACTIVADOS", async () => {
      const token = await registerAndLogin();
      const activo = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Activo ${randomUUID()}` })
        .expect(201);
      const inactivo = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Inactivo ${randomUUID()}` })
        .expect(201);
      const inactivoId = (inactivo.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/warehouses/${inactivoId}`)
        .set("Authorization", bearer(token))
        .send({ isActive: false })
        .expect(200);

      const scoped = await request(app.getHttpServer())
        .get("/warehouses?scoped=true")
        .set("Authorization", bearer(token))
        .expect(200);

      const ids = (scoped.body as { id: string }[]).map((w) => w.id);
      expect(ids).toContain((activo.body as { id: string }).id);
      expect(ids).not.toContain(inactivoId);
    });
  });
});
