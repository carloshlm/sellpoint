import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F3-HOME-01 — el almacén ASIGNADO de un usuario.
 *
 * Distinto del ALCANCE: el alcance es una lista (dónde PUEDE operar, vacío =
 * todos); el asignado es UNO (desde dónde opera por defecto). El POS de F4 no
 * puede vender desde "una lista": necesita un almacén concreto.
 */
describe("Almacén asignado del usuario (F3-HOME-01)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;
  const PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await startTestApp(app);
    mailer = app.get<NoopMailer>(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (token: string) => `Bearer ${token}`;

  async function registerActiveOwner(): Promise<{ token: string; userId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registro = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Acme ${randomUUID()}`,
        email,
        password: PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);

    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId: (registro.body as { userId: string }).userId,
    };
  }

  async function crearAlmacen(token: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function viewerRoleId(token: string): Promise<string> {
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(token))
      .expect(200);
    const viewer = (roles.body as { id: string; name: string }[]).find((r) => r.name === "Viewer");
    if (!viewer) throw new Error("Viewer no encontrado");
    return viewer.id;
  }

  async function crearUsuario(
    token: string,
    extra: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(token))
      .send({
        email: `user-${randomUUID()}@example.com`,
        firstName: "Beto",
        lastNamePaternal: "López",
        roleIds: [await viewerRoleId(token)],
        ...extra,
      });
  }

  it("el alta acepta el almacén asignado y el detalle lo devuelve", async () => {
    const { token } = await registerActiveOwner();
    const almacenId = await crearAlmacen(token, `Central ${randomUUID()}`);

    // A diferencia del ALCANCE (otro recurso, otro PUT), el asignado es una
    // COLUMNA: viaja en el mismo POST, sin escritura parcial posible.
    const creado = await crearUsuario(token, { defaultWarehouseId: almacenId });
    expect(creado.status).toBe(201);
    expect((creado.body as { defaultWarehouseId: string | null }).defaultWarehouseId).toBe(
      almacenId,
    );

    const detalle = await request(app.getHttpServer())
      .get(`/users/${(creado.body as { id: string }).id}`)
      .set("Authorization", bearer(token))
      .expect(200);
    expect((detalle.body as { defaultWarehouseId: string | null }).defaultWarehouseId).toBe(
      almacenId,
    );
  });

  it("sin asignar es válido: queda null", async () => {
    const { token } = await registerActiveOwner();
    const creado = await crearUsuario(token);

    expect(creado.status).toBe(201);
    expect((creado.body as { defaultWarehouseId: string | null }).defaultWarehouseId).toBeNull();
  });

  it("un almacén de otro tenant no se puede asignar", async () => {
    const a = await registerActiveOwner();
    const b = await registerActiveOwner();
    const ajeno = await crearAlmacen(b.token, `Ajeno ${randomUUID()}`);

    const res = await crearUsuario(a.token, { defaultWarehouseId: ajeno });
    expect(res.status).toBe(409);
  });

  it("un almacén inactivo no se puede asignar", async () => {
    const { token } = await registerActiveOwner();
    const almacenId = await crearAlmacen(token, `Cerrado ${randomUUID()}`);
    await request(app.getHttpServer())
      .patch(`/warehouses/${almacenId}`)
      .set("Authorization", bearer(token))
      .send({ isActive: false })
      .expect(200);

    const res = await crearUsuario(token, { defaultWarehouseId: almacenId });
    expect(res.status).toBe(409);
  });

  /**
   * La regla que cose asignación y alcance: si el usuario TIENE alcance (no
   * vacío), su asignado tiene que estar adentro. Si no, tendría por defecto un
   * almacén que no puede operar.
   */
  it("el asignado tiene que estar DENTRO del alcance cuando el alcance no está vacío", async () => {
    const { token } = await registerActiveOwner();
    const central = await crearAlmacen(token, `Central ${randomUUID()}`);
    const norte = await crearAlmacen(token, `Norte ${randomUUID()}`);

    const creado = await crearUsuario(token);
    const userId = (creado.body as { id: string }).id;

    await request(app.getHttpServer())
      .put(`/users/${userId}/warehouse-scope`)
      .set("Authorization", bearer(token))
      .send({ warehouseIds: [central] })
      .expect(200);

    const fuera = await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set("Authorization", bearer(token))
      .send({ defaultWarehouseId: norte });
    expect(fuera.status).toBe(409);
    expect((fuera.body as { code: string }).code).toBe("users.default_warehouse_out_of_scope");

    // Dentro del alcance, sí.
    await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set("Authorization", bearer(token))
      .send({ defaultWarehouseId: central })
      .expect(200);
  });

  /**
   * El espejo: encoger el alcance por debajo del asignado da 409 EXPLÍCITO y
   * NO auto-limpia. En F4 el turno de caja depende del asignado, y limpiarlo en
   * silencio dejaría al vendedor varado sin explicación.
   */
  it("encoger el alcance por debajo del asignado da 409, no lo limpia solo", async () => {
    const { token } = await registerActiveOwner();
    const central = await crearAlmacen(token, `Central ${randomUUID()}`);
    const norte = await crearAlmacen(token, `Norte ${randomUUID()}`);

    const creado = await crearUsuario(token, { defaultWarehouseId: central });
    const userId = (creado.body as { id: string }).id;

    const res = await request(app.getHttpServer())
      .put(`/users/${userId}/warehouse-scope`)
      .set("Authorization", bearer(token))
      .send({ warehouseIds: [norte] });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("users.default_warehouse_out_of_scope");

    // Y el asignado sigue intacto: nadie lo tocó por atrás.
    const detalle = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set("Authorization", bearer(token))
      .expect(200);
    expect((detalle.body as { defaultWarehouseId: string | null }).defaultWarehouseId).toBe(
      central,
    );
  });

  /** Vaciar el alcance es AMPLIAR el acceso: nunca puede chocar con el asignado. */
  it("vaciar el alcance con un asignado puesto es legal", async () => {
    const { token } = await registerActiveOwner();
    const central = await crearAlmacen(token, `Central ${randomUUID()}`);

    const creado = await crearUsuario(token, { defaultWarehouseId: central });
    const userId = (creado.body as { id: string }).id;

    await request(app.getHttpServer())
      .put(`/users/${userId}/warehouse-scope`)
      .set("Authorization", bearer(token))
      .send({ warehouseIds: [] })
      .expect(200);
  });

  it("se puede quitar el asignado mandando null", async () => {
    const { token } = await registerActiveOwner();
    const central = await crearAlmacen(token, `Central ${randomUUID()}`);
    const creado = await crearUsuario(token, { defaultWarehouseId: central });

    const res = await request(app.getHttpServer())
      .patch(`/users/${(creado.body as { id: string }).id}`)
      .set("Authorization", bearer(token))
      .send({ defaultWarehouseId: null })
      .expect(200);
    expect((res.body as { defaultWarehouseId: string | null }).defaultWarehouseId).toBeNull();
  });

  it("/me expone el asignado: el front lo necesita para preseleccionar", async () => {
    const { token, userId } = await registerActiveOwner();
    const central = await crearAlmacen(token, `Central ${randomUUID()}`);
    await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set("Authorization", bearer(token))
      .send({ defaultWarehouseId: central })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((me.body as { defaultWarehouseId: string | null }).defaultWarehouseId).toBe(central);
  });
});

/**
 * F3-HOME-03 — el tenant NACE con su almacén.
 *
 * Antes existía el estado "tenant sin almacén" hasta que alguien completaba el
 * paso 3 del onboarding — y el seed demo estaba `onboarded` sin ninguno. El POS
 * de F4 no puede vender desde la nada, así que ese estado deja de existir.
 */
describe("El tenant nace con su almacén (F3-HOME-03)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;
  const PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await startTestApp(app);
    mailer = app.get<NoopMailer>(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registrar(locale: "es" | "en"): Promise<{ token: string; userId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registro = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Nace ${randomUUID()}`,
        email,
        password: PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale,
      })
      .expect(201);

    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId: (registro.body as { userId: string }).userId,
    };
  }

  it("en español nace «Almacén Central» y queda asignado al owner", async () => {
    const { token, userId } = await registrar("es");

    const almacenes = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const lista = almacenes.body as { id: string; name: string }[];
    expect(lista).toHaveLength(1);
    expect(lista[0]?.name).toBe("Almacén Central");

    const detalle = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((detalle.body as { defaultWarehouseId: string | null }).defaultWarehouseId).toBe(
      lista[0]?.id,
    );
  });

  /** Neutro por LEY: un distribuidor lo renombra a CEDIS en un clic. */
  it("en inglés nace «Main Warehouse»", async () => {
    const { token } = await registrar("en");

    const almacenes = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((almacenes.body as { name: string }[])[0]?.name).toBe("Main Warehouse");
  });

  /** Y se puede renombrar: el nombre inicial es una sugerencia, no una ley. */
  it("el owner puede renombrarlo", async () => {
    const { token } = await registrar("es");
    const almacenes = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const id = (almacenes.body as { id: string }[])[0]?.id;

    const res = await request(app.getHttpServer())
      .patch(`/warehouses/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "CEDIS" })
      .expect(200);
    expect((res.body as { name: string }).name).toBe("CEDIS");
  });
});
