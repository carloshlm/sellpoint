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
import { usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-RECEP-17 — la configuración de Recepción de punta a punta: sin el
 * módulo 402; sin fila los defaults; la palabra entra en cualquier caja y
 * sale Capitalizada; dos palabras rebotan; `null` vuelve a la de fábrica;
 * quien solo lee el módulo la LEE (la pinta su pantalla) pero no la cambia.
 */
describe("Recepción — configuración (F9-RECEP-17)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let viewerToken: string;

  const get = (token: string) =>
    request(app.getHttpServer()).get("/reception/settings").set("Authorization", bearer(token));
  const put = (token: string, body: object) =>
    request(app.getHttpServer())
      .put("/reception/settings")
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

    admin = await registerTenant(app, "recep-settings-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocio = await registerTenant(app, "recep-settings");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
  });

  afterAll(async () => {
    await app.close();
  });

  it("sin el módulo, 402", async () => {
    await get(negocio.token).expect(402);
  });

  it("con el módulo: defaults, palabra Capitalizada, dos palabras rebotan, null vuelve a fábrica", async () => {
    await request(app.getHttpServer())
      .post(`/admin/billing/tenants/${negocio.tenantId}/modules`)
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception", customPrice: "1250.00", reason: "e2e" })
      .expect(201);
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "recep-settings-viewer");

    const inicial = await get(negocio.token).expect(200);
    expect(inicial.body).toEqual({ customerLabel: null, showCustomers: true, showTurns: true });

    const guardado = await put(negocio.token, {
      customerLabel: "pACIENTE",
      showTurns: false,
    }).expect(200);
    expect(guardado.body).toEqual({
      customerLabel: "Paciente",
      showCustomers: true,
      showTurns: false,
    });

    await put(negocio.token, { customerLabel: "Paciente nuevo" }).expect(400);
    await put(negocio.token, { customerLabel: "" }).expect(400);
    await put(negocio.token, {}).expect(400);

    const releido = await get(negocio.token).expect(200);
    expect(releido.body).toEqual({
      customerLabel: "Paciente",
      showCustomers: true,
      showTurns: false,
    });

    const fabrica = await put(negocio.token, { customerLabel: null }).expect(200);
    expect(fabrica.body.customerLabel).toBeNull();
  });

  it("quien solo lee el módulo la lee, pero no la cambia", async () => {
    const lectura = await get(viewerToken).expect(200);
    expect(lectura.body).toMatchObject({ showTurns: false });
    await put(viewerToken, { showTurns: true }).expect(403);
  });
});
