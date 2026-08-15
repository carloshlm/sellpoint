import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

const PASSWORD = "twelve-characters";

/**
 * e2e de F1-RBAC-05 (`GET /permissions`). Catálogo GLOBAL agrupado por
 * módulo — dev tiene 10 codes (prisma/seed.ts), CI/prod tienen 4 (migración
 * de F1-RBAC-01/02). Nunca assertar el TAMAÑO del catálogo.
 */
describe("GET /permissions (e2e, F1-RBAC-05)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    mailer = app.get<NoopMailer>(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

  async function ownerAccessToken(): Promise<string> {
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
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

    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = extractTokenFromLink(sentMail?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);

    return login.body.accessToken as string;
  }

  it("devuelve el catálogo agrupado por módulo, con los codes mínimos de F1 presentes", async () => {
    const accessToken = await ownerAccessToken();

    const response = await request(app.getHttpServer())
      .get("/permissions")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const groups = response.body as Array<{
      module: string;
      permissions: Array<{ code: string; description: string | null }>;
    }>;

    const rolesGroup = groups.find((g) => g.module === "roles");
    const usersGroup = groups.find((g) => g.module === "users");
    expect(rolesGroup?.permissions.map((p) => p.code)).toEqual(
      expect.arrayContaining(["roles:read", "roles:manage"]),
    );
    expect(usersGroup?.permissions.map((p) => p.code)).toEqual(
      expect.arrayContaining(["users:read", "users:manage"]),
    );
  });

  it("sin token -> 401 (secure by default)", async () => {
    await request(app.getHttpServer()).get("/permissions").expect(401);
  });

  // La cobertura de "con token pero sin roles:read -> 403" vive en la
  // matriz de F1-RBAC-06 (rbac-users-roles-matrix.e2e-spec.ts), que ya
  // ejercita este mismo endpoint por rol junto con /users y /roles.
});
