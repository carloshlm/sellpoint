import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-RECEP-15 — los turnos de punta a punta: la serie del día arranca en 1
 * y cada negocio lleva la suya; el turno ligado trae el nombre y lo conserva
 * aunque el cliente se borre; atender es idempotente y se puede deshacer;
 * el filtro de fecha separa los días.
 */
describe("Recepción — turnos (F9-RECEP-15)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let otro: TenantFixture;

  const activarRecepcion = (tenantId: string) =>
    request(app.getHttpServer())
      .post(`/admin/billing/tenants/${tenantId}/modules`)
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception", customPrice: "1250.00", reason: "e2e" })
      .expect(201);

  const generar = (token: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post("/reception/turns")
      .set("Authorization", bearer(token))
      .send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "turns-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocio = await registerTenant(app, "turns");
    otro = await registerTenant(app, "turns-otro");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await setTenantMarket(prisma, otro.tenantId, "MX");
    // El otro negocio vive en Madrid: su día del negocio es otro y su serie también.
    await prisma.tenant.update({
      where: { id: otro.tenantId },
      data: { timezone: "Europe/Madrid" },
    });
    await activarRecepcion(negocio.tenantId);
    await activarRecepcion(otro.tenantId);
  });

  afterAll(async () => {
    await app.close();
  });

  it("tres turnos seguidos dan 1, 2, 3 y el listado del día los trae del mayor al menor", async () => {
    const numeros: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await generar(negocio.token).expect(201);
      numeros.push((res.body as { number: number }).number);
    }
    expect(numeros).toEqual([1, 2, 3]);

    const lista = await request(app.getHttpServer())
      .get("/reception/turns")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const filas = lista.body as { number: number; status: string; customerName: string | null }[];
    expect(filas.map((f) => f.number)).toEqual([3, 2, 1]);
    expect(filas.every((f) => f.status === "waiting" && f.customerName === null)).toBe(true);
  });

  it("otro negocio, en otra zona, lleva su propia serie desde 1", async () => {
    const res = await generar(otro.token).expect(201);
    expect((res.body as { number: number }).number).toBe(1);
  });

  it("el turno ligado trae el nombre y lo conserva aunque el cliente se borre", async () => {
    const cliente = await request(app.getHttpServer())
      .post("/reception/customers")
      .set("Authorization", bearer(negocio.token))
      .send({ firstName: "Rosa", lastNamePaternal: "Luna", lastNameMaternal: "Ríos" })
      .expect(201);
    const customerId = (cliente.body as { id: string }).id;

    const turno = await generar(negocio.token, { customerId }).expect(201);
    expect(turno.body).toMatchObject({ customerId, customerName: "Rosa Luna Ríos" });

    await request(app.getHttpServer())
      .delete(`/reception/customers/${customerId}`)
      .set("Authorization", bearer(negocio.token))
      .expect(204);

    const lista = await request(app.getHttpServer())
      .get("/reception/turns")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const vivo = (
      lista.body as { id: string; customerId: string | null; customerName: string | null }[]
    ).find((f) => f.id === (turno.body as { id: string }).id);
    expect(vivo).toMatchObject({ customerId: null, customerName: "Rosa Luna Ríos" });
  });

  it("un cliente de otro negocio no se puede ligar: 404", async () => {
    const ajeno = await request(app.getHttpServer())
      .post("/reception/customers")
      .set("Authorization", bearer(otro.token))
      .send({ firstName: "Ajena", lastNamePaternal: "Ajena" })
      .expect(201);
    await generar(negocio.token, { customerId: (ajeno.body as { id: string }).id }).expect(404);
  });

  it("atender dos veces devuelve el mismo instante; volver a espera lo limpia", async () => {
    const turno = await generar(negocio.token).expect(201);
    const id = (turno.body as { id: string }).id;

    const primera = await request(app.getHttpServer())
      .post(`/reception/turns/${id}/attend`)
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const segunda = await request(app.getHttpServer())
      .post(`/reception/turns/${id}/attend`)
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((primera.body as { attendedAt: string }).attendedAt).toBeTruthy();
    expect((segunda.body as { attendedAt: string }).attendedAt).toBe(
      (primera.body as { attendedAt: string }).attendedAt,
    );

    const espera = await request(app.getHttpServer())
      .post(`/reception/turns/${id}/wait`)
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect(espera.body).toMatchObject({ status: "waiting", attendedAt: null });
  });

  it("un turno ajeno no se atiende: 404", async () => {
    const turno = await generar(otro.token).expect(201);
    await request(app.getHttpServer())
      .post(`/reception/turns/${(turno.body as { id: string }).id}/attend`)
      .set("Authorization", bearer(negocio.token))
      .expect(404);
  });

  it("el papel del turno baja como PDF térmico; el de otro negocio, 404", async () => {
    const turno = await generar(negocio.token, {}).expect(201);
    const id = (turno.body as { id: string }).id;
    const papel = await request(app.getHttpServer())
      .get(`/reception/turns/${id}/ticket`)
      .query({ width: "58mm" })
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect(papel.headers["content-type"]).toContain("application/pdf");
    expect(papel.headers["content-disposition"]).toContain("turno-");
    await request(app.getHttpServer())
      .get(`/reception/turns/${id}/ticket`)
      .set("Authorization", bearer(otro.token))
      .expect(404);
  });

  it("el filtro de fecha separa los días: otro día no trae los de hoy", async () => {
    const otroDia = await request(app.getHttpServer())
      .get("/reception/turns")
      .query({ date: "2000-01-01" })
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect(otroDia.body).toEqual([]);
    await request(app.getHttpServer())
      .get("/reception/turns")
      .query({ date: "hoy" })
      .set("Authorization", bearer(negocio.token))
      .expect(400);
  });
});
