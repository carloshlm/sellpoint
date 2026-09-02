import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { localCalendarDate } from "@sellpoint/shared";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * El listado de documentos y su rango Desde/Hasta (Carlos, 2026-09-02).
 *
 * La «Fecha» de un documento es la de su ESTADO: apertura en borrador,
 * asiento en confirmado, cancelación en cancelado. El rango filtra por ESA
 * fecha, la misma que la columna muestra — filtrar por la apertura mientras
 * la pantalla enseña el asiento contaría dos historias.
 *
 * Los días se calculan con el calendario del NEGOCIO (`America/Mexico_City`,
 * el default del tenant) y con offsets de 3 y 2 días, para que un cambio de
 * día en CDMX a mitad de la corrida no vuelva inestable la prueba.
 */
describe("Listado de documentos — la fecha del estado (2026-09-02)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";
  const ZONA = "America/Mexico_City";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
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

  const bearer = (t: string) => `Bearer ${t}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant fechas ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);
    const mailer = app.get<NoopMailer>(MAILER);
    const link = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token: link }).expect(200);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);
    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  const hace = (dias: number): Date => new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const dia = (instante: Date): string => localCalendarDate(ZONA, instante);

  async function escenario() {
    const { token, tenantId } = await registerAndLogin();
    const auth = () => ({ Authorization: bearer(token) });
    const warehouse = await request(app.getHttpServer())
      .post("/warehouses")
      .set(auth())
      .send({ name: `Central ${randomUUID().slice(0, 6)}` })
      .expect(201);
    const warehouseId = (warehouse.body as { id: string }).id;
    const producto = await request(app.getHttpServer())
      .post("/products")
      .set(auth())
      .send({ sku: `FEC-${randomUUID().slice(0, 8)}`, name: "Jabón", price: 10 })
      .expect(201);
    const productId = (producto.body as { id: string }).id;

    /** Un borrador de entrada con una línea, abierto (según la base) hace `dias` días. */
    async function borradorAbiertoHace(dias: number): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type: "entry", warehouseId })
        .expect(201);
      const id = (res.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ reasonCode: "adjustment", reasonNote: "prueba de fechas" })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines`)
        .set(auth())
        .send({ productId, quantity: 4 })
        .expect(201);
      // Retro-fechar la apertura: `created_at` la pone la base y ningún
      // endpoint la acepta, así que se corrige por debajo.
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.inventoryDocument.update({ where: { id }, data: { createdAt: hace(dias) } }),
      );
      return id;
    }

    const listar = (query: string) =>
      request(app.getHttpServer())
        .get(`/inventory/documents?type=entry&${query}`)
        .set(auth())
        .expect(200)
        .then((res) => res.body as { rows: { id: string; canceledAt: string | null }[] });

    const confirmar = (id: string) =>
      request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set(auth())
        .send({})
        .expect(201);
    const cancelar = (id: string) =>
      request(app.getHttpServer())
        .post(`/inventory/documents/${id}/cancel`)
        .set(auth())
        .send({ reason: "Se canceló para la prueba" })
        .expect(200);

    return { borradorAbiertoHace, listar, confirmar, cancelar };
  }

  it("un confirmado se filtra por el día del ASIENTO, no por el de apertura", async () => {
    const { borradorAbiertoHace, listar, confirmar } = await escenario();
    const id = await borradorAbiertoHace(3);
    await confirmar(id);

    const hoy = await listar(`status=confirmed&from=${dia(new Date())}`);
    const viejos = await listar(`status=confirmed&to=${dia(hace(2))}`);

    expect(hoy.rows.map((r) => r.id)).toEqual([id]);
    expect(viejos.rows.map((r) => r.id)).toEqual([]);
  });

  it("un borrador se filtra por su apertura", async () => {
    const { borradorAbiertoHace, listar } = await escenario();
    const id = await borradorAbiertoHace(3);

    const viejos = await listar(`status=draft&to=${dia(hace(2))}`);
    const hoy = await listar(`status=draft&from=${dia(new Date())}`);

    expect(viejos.rows.map((r) => r.id)).toEqual([id]);
    expect(hoy.rows.map((r) => r.id)).toEqual([]);
  });

  it("un cancelado se filtra por el día de la cancelación y la fila la expone", async () => {
    const { borradorAbiertoHace, listar, cancelar } = await escenario();
    const id = await borradorAbiertoHace(3);
    await cancelar(id);

    const hoy = await listar(`status=canceled&from=${dia(new Date())}`);

    expect(hoy.rows.map((r) => r.id)).toEqual([id]);
    expect(hoy.rows[0]?.canceledAt).not.toBeNull();
  });

  it("la pestaña Activos (borradores y confirmados) filtra a cada uno por lo suyo", async () => {
    const { borradorAbiertoHace, listar, confirmar } = await escenario();
    const confirmado = await borradorAbiertoHace(3);
    await confirmar(confirmado);
    const borrador = await borradorAbiertoHace(3);

    const hoy = await listar(`from=${dia(new Date())}`);
    const viejos = await listar(`to=${dia(hace(2))}`);

    expect(hoy.rows.map((r) => r.id)).toEqual([confirmado]);
    expect(viejos.rows.map((r) => r.id)).toEqual([borrador]);
  });
});
