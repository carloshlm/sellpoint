import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/**
 * e2e de F1-TENANT-03: valida el aislamiento RLS entre 2 tenants con la DB
 * real, corriendo como `sellpoint_app` (sin bypass, igual que en CI/prod —
 * `test/setup-env.js` fuerza ese default). Los tenants se crean con el
 * flujo real de dominio (`POST /auth/register-tenant` + `verify-email`, U2
 * de f1-auth), no con filas fabricadas a mano.
 *
 * No hay todavía ningún endpoint HTTP que liste usuarios entre tenants
 * (eso es f1-rbac/f2), así que las aserciones de aislamiento leen
 * directamente con la MISMA instancia de `PrismaService` que usa la app
 * (`app.get(PrismaService)`) — es la pieza que F1-TENANT-02 ya integra en
 * todos los services de dominio (`withTenantContext`), acá se ejercita
 * contra Postgres real en vez de mockearla.
 */
describe("Aislamiento RLS entre tenants (e2e, F1-TENANT-03)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    tenantA = await registerActiveTenant();
    tenantB = await registerActiveTenant();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerActiveTenant(): Promise<{ tenantId: string; userId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registerResponse = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant RLS ${randomUUID()}`,
        email,
        password: "twelve-characters",
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = extractTokenFromLink(sentMail?.vars.link);

    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    return registerResponse.body as { tenantId: string; userId: string };
  }

  let tenantA: { tenantId: string; userId: string };
  let tenantB: { tenantId: string; userId: string };

  it("(a) el contexto de un tenant NO ve las filas del otro", async () => {
    const usersFromA = await prisma.withTenantContext(tenantA.tenantId, (tx) => tx.user.findMany());
    expect(usersFromA.map((u) => u.id)).toEqual([tenantA.userId]);
    expect(usersFromA.every((u) => u.tenantId === tenantA.tenantId)).toBe(true);

    const usersFromB = await prisma.withTenantContext(tenantB.tenantId, (tx) => tx.user.findMany());
    expect(usersFromB.map((u) => u.id)).toEqual([tenantB.userId]);
    expect(usersFromB.every((u) => u.tenantId === tenantB.tenantId)).toBe(true);
  });

  it("(b) sin contexto seteado no se ve NINGUNA fila (0, no error)", async () => {
    await expect(prisma.user.findMany()).resolves.toHaveLength(0);
    await expect(prisma.$queryRaw`SELECT * FROM users`).resolves.toHaveLength(0);
  });

  it("(c) un INSERT con tenant_id ajeno es rechazado por la policy (WITH CHECK)", async () => {
    await expect(
      prisma.withTenantContext(tenantA.tenantId, (tx) =>
        tx.user.create({
          data: {
            tenantId: tenantB.tenantId,
            email: `intruso-${randomUUID()}@example.com`,
            firstName: "Intruso",
            lastNamePaternal: "Cross-Tenant",
          },
        }),
      ),
    ).rejects.toThrow();

    // La fila filtrada nunca llegó a existir en el tenant destino.
    const usersFromB = await prisma.withTenantContext(tenantB.tenantId, (tx) => tx.user.findMany());
    expect(usersFromB).toHaveLength(1);
    expect(usersFromB[0]?.id).toBe(tenantB.userId);
  });

  it("corriendo como sellpoint_app (sin bypass): current_user no es el superuser", async () => {
    const [{ current_user: currentUser }] = await prisma.$queryRaw<
      Array<{ current_user: string }>
    >`SELECT current_user`;

    expect(currentUser).toBe("sellpoint_app");
  });
});
