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
    viewerToken = await usuarioConRol(app, negocio, "viewer", "recep-settings-viewer");

    const inicial = await get(negocio.token).expect(200);
    expect(inicial.body).toEqual({
      customerLabel: null,
      showCustomers: true,
      showTurns: true,
      turnServiceIds: [],
    });

    const guardado = await put(negocio.token, {
      customerLabel: "pACIENTE",
      showTurns: false,
    }).expect(200);
    expect(guardado.body).toEqual({
      customerLabel: "Paciente",
      showCustomers: true,
      showTurns: false,
      turnServiceIds: [],
    });

    await put(negocio.token, { customerLabel: "Paciente nuevo" }).expect(400);
    await put(negocio.token, { customerLabel: "" }).expect(400);
    await put(negocio.token, {}).expect(400);

    const releido = await get(negocio.token).expect(200);
    expect(releido.body).toEqual({
      customerLabel: "Paciente",
      showCustomers: true,
      showTurns: false,
      turnServiceIds: [],
    });

    const fabrica = await put(negocio.token, { customerLabel: null }).expect(200);
    expect(fabrica.body.customerLabel).toBeNull();
  });

  it("quien solo lee el módulo la lee, pero no la cambia", async () => {
    const lectura = await get(viewerToken).expect(200);
    expect(lectura.body).toMatchObject({ showTurns: false });
    await put(viewerToken, { showTurns: true }).expect(403);
  });

  /**
   * F9-RECEP-25 — los servicios que generan turno al venderse (ley 31). Se
   * mandan COMPLETOS; cada uno tiene que ser un servicio activo de ESTE
   * negocio, y la RLS hace que uno de otro negocio ni siquiera exista.
   */
  describe("los servicios que generan turno (F9-RECEP-25)", () => {
    const servicio = (tenantId: string, code: string, isActive = true) =>
      prisma.withTenantContext(tenantId, (tx) =>
        tx.service.create({ data: { tenantId, code, name: `Servicio ${code}`, isActive } }),
      );

    it("se guardan, se releen y se vacían (es un conjunto: el orden no importa)", async () => {
      const consulta = await servicio(negocio.tenantId, "E2E-CONSULTA");
      const especialidad = await servicio(negocio.tenantId, "E2E-ESPECIALIDAD");

      const guardado = await put(negocio.token, {
        turnServiceIds: [consulta.id, especialidad.id],
      }).expect(200);
      const ambos = [consulta.id, especialidad.id].sort();
      expect([...guardado.body.turnServiceIds].sort()).toEqual(ambos);

      const releido = await get(negocio.token).expect(200);
      expect([...releido.body.turnServiceIds].sort()).toEqual(ambos);
      // El que solo lee el módulo también los ve: su pantalla los necesita.
      const lectura = await get(viewerToken).expect(200);
      expect([...lectura.body.turnServiceIds].sort()).toEqual(ambos);

      const uno = await put(negocio.token, { turnServiceIds: [especialidad.id] }).expect(200);
      expect(uno.body.turnServiceIds).toEqual([especialidad.id]);

      const vacio = await put(negocio.token, { turnServiceIds: [] }).expect(200);
      expect(vacio.body.turnServiceIds).toEqual([]);
    });

    it("un servicio inactivo, uno de otro negocio o uno repetido rebotan con 400", async () => {
      const activo = await servicio(negocio.tenantId, "E2E-ACTIVO");
      const inactivo = await servicio(negocio.tenantId, "E2E-INACTIVO", false);
      const ajeno = await servicio(admin.tenantId, "E2E-AJENO");

      await put(negocio.token, { turnServiceIds: [activo.id, inactivo.id] }).expect(400);
      await put(negocio.token, { turnServiceIds: [ajeno.id] }).expect(400);
      await put(negocio.token, { turnServiceIds: [activo.id, activo.id] }).expect(400);

      // Nada de eso tocó la lista.
      const releido = await get(negocio.token).expect(200);
      expect(releido.body.turnServiceIds).toEqual([]);
    });
  });
});
