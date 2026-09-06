import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, registerTenant, type TenantFixture } from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F7-CONTACT (Carlos, 2026-09-05) — desde «Mi plan», el negocio nos escribe
 * para activar su plan: el correo llega a los administradores de la
 * plataforma con negocio, nombre, correo y mensaje, y el negocio recibe un
 * acuse en su idioma.
 */
describe("«Escríbenos para activar tu plan» (F7-CONTACT)", () => {
  let app: INestApplication<App>;
  let negocio: TenantFixture;
  let mailer: NoopMailer;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    mailer = app.get<NoopMailer>(MAILER);
    app.get(ConfigService).set("BILLING_ADMIN_EMAILS", "carls.hlm@gmail.com, otro@sellpointy.com");
    negocio = await registerTenant(app, "plan-request");
  });

  afterAll(async () => {
    await app.close();
  });

  it("manda el mensaje con negocio, nombre y correo a cada admin, y el acuse al negocio", async () => {
    const antes = mailer.sent.length;
    await request(app.getHttpServer())
      .post("/billing/me/plan-request")
      .set("Authorization", bearer(negocio.token))
      .send({ message: "Quiero activar el plan Pro para mi tienda." })
      .expect(200)
      .expect({ sent: true });

    const nuevos = mailer.sent.slice(antes);
    const aAdmins = nuevos.filter((m) => m.template === "plan-request");
    expect(aAdmins.map((m) => m.to).sort()).toEqual(["carls.hlm@gmail.com", "otro@sellpointy.com"]);
    expect(aAdmins[0]?.vars).toMatchObject({
      userName: "Ana Pérez",
      userEmail: negocio.email,
      message: "Quiero activar el plan Pro para mi tienda.",
    });
    expect(aAdmins[0]?.vars.tenantName).toContain("Negocio plan-request");
    const acuse = nuevos.find((m) => m.template === "plan-request-received");
    expect(acuse).toMatchObject({ to: negocio.email, locale: "es" });
  });

  it("un mensaje de menos de 10 caracteres → 400", async () => {
    await request(app.getHttpServer())
      .post("/billing/me/plan-request")
      .set("Authorization", bearer(negocio.token))
      .send({ message: "hola" })
      .expect(400);
  });
});
