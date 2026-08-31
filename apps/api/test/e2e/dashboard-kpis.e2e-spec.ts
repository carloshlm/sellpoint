import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F5-DASH-03 — el cableado HTTP del endpoint de KPIs.
 *
 * La MATEMÁTICA (día local, corridos, utilidad, alcance) vive en el spec de
 * integración con reloj falso — acá se prueba lo que solo el HTTP puede
 * probar: la puerta del permiso y que la forma real viaja completa.
 */
describe("GET /reports/dashboard/kpis (F5-DASH-03)", () => {
  let app: INestApplication<App>;
  let tokenService: TokenService;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function ownerToken(): Promise<{ token: string; tenantId: string }> {
    const email = `kpi-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant kpi ${randomUUID()}`,
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
    const body = login.body as { accessToken: string };
    const payload = JSON.parse(
      Buffer.from(body.accessToken.split(".")[1] as string, "base64").toString(),
    ) as { tenantId: string };
    return { token: body.accessToken, tenantId: payload.tenantId };
  }

  it("con reports:read responde la forma completa — un negocio nuevo, en ceros y nulls", async () => {
    const { token } = await ownerToken();

    const res = await request(app.getHttpServer())
      .get("/reports/dashboard/kpis")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      today: { total: "0", tickets: 0, averageTicket: null, deltaVsLastWeekPct: null },
      month: { total: "0", deltaVsPrevMonthPct: null, goal: null, goalPct: null },
      profit: { month: null },
    });
  });

  it("un vendedor sin reports:read -> 403: los números del negocio no son del mostrador", async () => {
    const { tenantId } = await ownerToken();
    const vendedor = tokenService.signAccessToken({
      sub: randomUUID(),
      tenantId,
      permissions: ["pos:sell", "pos:view"],
      locale: "es",
    });

    await request(app.getHttpServer())
      .get("/reports/dashboard/kpis")
      .set("Authorization", `Bearer ${vendedor}`)
      .expect(403);
  });
});
