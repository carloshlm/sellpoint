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

/**
 * F3-SVC-03 — CRUD del catálogo de Servicios con tenants reales.
 *
 * Un servicio se vende pero NO mueve inventario: acá se prueba el catálogo;
 * que el POS lo cobre llega en F4.
 */
describe("Servicios (F3-SVC)", () => {
  /**
   * La paginación de servicios (Carlos, 2026-08-25): el listado traía TODO,
   * sin límite ni en el server. Con cientos de servicios, cada apertura de la
   * pantalla cargaba el catálogo entero.
   *
   * El contrato cambia de `Service[]` a `{rows, total, page, pageSize}` — la
   * misma forma que productos, documentos y ventas.
   */
  describe("la paginación (2026-08-25)", () => {
    it("devuelve la página pedida con su total", async () => {
      const token = await registerAndLogin();
      for (let i = 0; i < 25; i += 1) {
        await request(app.getHttpServer())
          .post("/services")
          .set("Authorization", bearer(token))
          .send({
            code: `PAG${String(i).padStart(3, "0")}`,
            name: `Servicio ${i}`,
            price: 10,
            warehouseIds: [],
          })
          .expect(201);
      }

      const primera = await request(app.getHttpServer())
        .get("/services?page=1&pageSize=20")
        .set("Authorization", bearer(token))
        .expect(200);
      const segunda = await request(app.getHttpServer())
        .get("/services?page=2&pageSize=20")
        .set("Authorization", bearer(token))
        .expect(200);

      const p1 = primera.body as { rows: { code: string }[]; total: number };
      const p2 = segunda.body as { rows: { code: string }[]; total: number };
      expect(p1.total).toBe(25);
      expect(p1.rows).toHaveLength(20);
      expect(p2.rows).toHaveLength(5);
      // Sin repetidos entre páginas: el orden es estable.
      const codigos = new Set([...p1.rows, ...p2.rows].map((r) => r.code));
      expect(codigos.size).toBe(25);
    });

    it("sin parámetros aplica el default de 20: nunca vuelve el «todo»", async () => {
      const token = await registerAndLogin();
      for (let i = 0; i < 22; i += 1) {
        await request(app.getHttpServer())
          .post("/services")
          .set("Authorization", bearer(token))
          .send({
            code: `DEF${String(i).padStart(3, "0")}`,
            name: `Servicio ${i}`,
            price: 10,
            warehouseIds: [],
          })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .get("/services")
        .set("Authorization", bearer(token))
        .expect(200);

      const body = res.body as { rows: unknown[]; total: number; pageSize: number };
      expect(body.rows).toHaveLength(20);
      expect(body.total).toBe(22);
      expect(body.pageSize).toBe(20);
    });
  });

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
        tenantName: `Tenant servicios ${randomUUID()}`,
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

  it("crea, lista, edita, desactiva y elimina un servicio", async () => {
    const token = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "CORTE", name: "Corte de cabello", cost: 40, price: 150, warehouseIds: [] })
      .expect(201);
    const id = (created.body as { id: string }).id;
    // Los importes viajan como string, igual que en productos: un Decimal
    // serializado a number pierde precisión en el camino.
    expect(created.body).toMatchObject({ code: "CORTE", price: "150", isActive: true });

    const listed = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((listed.body as { rows: { code: string }[] }).rows.map((s) => s.code)).toEqual([
      "CORTE",
    ]);

    await request(app.getHttpServer())
      .patch(`/services/${id}`)
      .set("Authorization", bearer(token))
      .send({ name: "Corte y peinado", price: 180 })
      .expect(200);

    const desactivado = await request(app.getHttpServer())
      .patch(`/services/${id}`)
      .set("Authorization", bearer(token))
      .send({ isActive: false })
      .expect(200);
    expect((desactivado.body as { isActive: boolean }).isActive).toBe(false);

    await request(app.getHttpServer())
      .delete(`/services/${id}`)
      .set("Authorization", bearer(token))
      .expect(204);

    const vacio = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((vacio.body as { rows: unknown[]; total: number }).rows).toEqual([]);
  });

  it("el código repetido en el mismo tenant da 409", async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "LAVADO", name: "Lavado", warehouseIds: [] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "LAVADO", name: "Otro lavado", warehouseIds: [] })
      .expect(409);
    expect((res.body as { code: string }).code).toBe("services.code_taken");
  });

  /** El catálogo es de cada negocio: dos peluquerías usan "CORTE" sin chocar. */
  it("dos tenants pueden usar el mismo código", async () => {
    // Secuencial y no `Promise.all`: dos registros concurrentes contra el mismo
    // servidor de pruebas no aportan nada al caso y sí ruido al diagnóstico.
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const body = { code: "MISMO", name: "Servicio", warehouseIds: [] };

    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(a))
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(b))
      .send(body)
      .expect(201);
  });

  it("un tenant no ve ni toca los servicios de otro", async () => {
    // Secuencial y no `Promise.all`: dos registros concurrentes contra el mismo
    // servidor de pruebas no aportan nada al caso y sí ruido al diagnóstico.
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const created = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(a))
      .send({ code: "PRIVADO", name: "Solo de A", warehouseIds: [] })
      .expect(201);
    const id = (created.body as { id: string }).id;

    const listado = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(b))
      .expect(200);
    expect((listado.body as { rows: unknown[] }).rows).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/services/${id}`)
      .set("Authorization", bearer(b))
      .send({ name: "Robado" })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/services/${id}`)
      .set("Authorization", bearer(b))
      .expect(404);
  });

  it("busca por código y por nombre, sin distinguir mayúsculas", async () => {
    const token = await registerAndLogin();
    for (const s of [
      { code: "TINTE", name: "Tinte completo", warehouseIds: [] },
      { code: "MANI", name: "Manicura", warehouseIds: [] },
    ]) {
      await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send(s)
        .expect(201);
    }

    const porNombre = await request(app.getHttpServer())
      .get("/services?query=manicu")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((porNombre.body as { rows: { code: string }[] }).rows.map((s) => s.code)).toEqual([
      "MANI",
    ]);

    const porCodigo = await request(app.getHttpServer())
      .get("/services?query=tin")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((porCodigo.body as { rows: { code: string }[] }).rows.map((s) => s.code)).toEqual([
      "TINTE",
    ]);
  });

  async function crearAlmacen(token: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** El almacén con el que nace el tenant (F3-HOME-03). */
  async function almacenInicial(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(token))
      .expect(200);
    return (res.body as { id: string }[])[0]?.id ?? "";
  }

  /**
   * F3-SVC-07 — en qué almacenes se ofrece cada servicio.
   *
   * Semántica EXPLÍCITA: sin almacenes marcados el servicio NO se vende. Es al
   * revés que el alcance de usuarios (vacío = todos) — decisión de Carlos: el
   * checklist ES la disponibilidad.
   */
  describe("los almacenes donde se ofrece (F3-SVC-07)", () => {
    it("crear con un subset guarda solo esos, en la misma transacción", async () => {
      const token = await registerAndLogin();
      const central = await almacenInicial(token);
      await crearAlmacen(token, `Norte ${randomUUID()}`);

      const creado = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({ code: "CORTE", name: "Corte", warehouseIds: [central] })
        .expect(201);

      expect((creado.body as { warehouseIds: string[] }).warehouseIds).toEqual([central]);
    });

    it("el listado devuelve los ids de cada servicio", async () => {
      const token = await registerAndLogin();
      const central = await almacenInicial(token);
      await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({ code: "TINTE", name: "Tinte", warehouseIds: [central] })
        .expect(201);

      const lista = await request(app.getHttpServer())
        .get("/services")
        .set("Authorization", bearer(token))
        .expect(200);
      expect((lista.body as { rows: { warehouseIds: string[] }[] }).rows[0]?.warehouseIds).toEqual([
        central,
      ]);
    });

    /** Sin almacenes es un estado VÁLIDO: un servicio en preparación. */
    it("crear sin almacenes es válido y el servicio queda sin venderse", async () => {
      const token = await registerAndLogin();

      const creado = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({ code: "BORRADOR", name: "En preparación", warehouseIds: [] })
        .expect(201);

      expect((creado.body as { warehouseIds: string[] }).warehouseIds).toEqual([]);
    });

    /** El PATCH REEMPLAZA el set completo, no hace delta (doctrina del repo). */
    it("editar reemplaza el set completo", async () => {
      const token = await registerAndLogin();
      const central = await almacenInicial(token);
      const norte = await crearAlmacen(token, `Norte ${randomUUID()}`);

      const creado = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({ code: "MANI", name: "Manicura", warehouseIds: [central, norte] })
        .expect(201);

      const editado = await request(app.getHttpServer())
        .patch(`/services/${(creado.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .send({ warehouseIds: [norte] })
        .expect(200);

      expect((editado.body as { warehouseIds: string[] }).warehouseIds).toEqual([norte]);
    });

    /** Ausente ≠ vacío: un PATCH que no lo menciona no toca las asociaciones. */
    it("un PATCH sin warehouseIds no toca las asociaciones", async () => {
      const token = await registerAndLogin();
      const central = await almacenInicial(token);
      const creado = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({ code: "LAVADO", name: "Lavado", warehouseIds: [central] })
        .expect(201);

      const editado = await request(app.getHttpServer())
        .patch(`/services/${(creado.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .send({ name: "Lavado premium" })
        .expect(200);

      expect((editado.body as { warehouseIds: string[] }).warehouseIds).toEqual([central]);
    });

    it("un almacén de otro tenant da 409", async () => {
      const a = await registerAndLogin();
      const b = await registerAndLogin();
      const ajeno = await crearAlmacen(b, `Ajeno ${randomUUID()}`);

      const res = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(a))
        .send({ code: "X", name: "X", warehouseIds: [ajeno] })
        .expect(409);
      expect((res.body as { code: string }).code).toBe("services.warehouses_invalid");
    });

    it("un almacén desactivado da 409", async () => {
      const token = await registerAndLogin();
      const cerrado = await crearAlmacen(token, `Cerrado ${randomUUID()}`);
      await request(app.getHttpServer())
        .patch(`/warehouses/${cerrado}`)
        .set("Authorization", bearer(token))
        .send({ isActive: false })
        .expect(200);

      await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({ code: "Y", name: "Y", warehouseIds: [cerrado] })
        .expect(409);
    });

    /** Borrar el servicio se lleva sus asociaciones: la FK es CASCADE. */
    it("borrar el servicio limpia sus asociaciones", async () => {
      const token = await registerAndLogin();
      const central = await almacenInicial(token);
      const creado = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({ code: "TEMP", name: "Temporal", warehouseIds: [central] })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/services/${(creado.body as { id: string }).id}`)
        .set("Authorization", bearer(token))
        .expect(204);
    });
  });

  it("un precio negativo o con demasiados decimales se rechaza", async () => {
    const token = await registerAndLogin();

    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "NEG", name: "Negativo", price: -1, warehouseIds: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "DEC", name: "Decimales", price: 10.123, warehouseIds: [] })
      .expect(400);
  });
});
