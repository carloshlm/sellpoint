import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { TERMS_VERSION } from "../../src/modules/legal/terms.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F11-SITE-LEGAL-02/03 — los términos, de punta a punta y en sus DOS estados.
 *
 * Este archivo levanta DOS aplicaciones: una con `TERMS_VERSION` en `null`
 * (lo que corre en producción hoy) y otra con una versión de mentira. Es la
 * única forma de comprobar que encender es de verdad cambiar una constante:
 * el provider que se sobrescribe acá es exactamente el que `LegalModule`
 * alimenta con `CURRENT_TERMS_VERSION`.
 *
 * ⚠️ La versión de prueba es inventada a propósito. Los textos legales todavía
 * tienen `[[huecos]]`: si algún día este valor coincidiera con uno publicado
 * de verdad, sería casualidad, no contrato.
 */
const VERSION_DE_PRUEBA = "2026-10-01-e2e";
const PASSWORD = "twelve-characters";

async function bootApp(termsVersion: string | null): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useClass(NoopMailer)
    .overrideProvider(TERMS_VERSION)
    .useValue(termsVersion)
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  await startTestApp(app);
  return app;
}

/** El alta real y completa: registro + verificación del correo. */
async function registerActiveUser(
  app: INestApplication<App>,
  body: Record<string, unknown> = {},
): Promise<{ tenantId: string; userId: string; email: string }> {
  const email = `owner-${randomUUID()}@example.com`;
  const response = await request(app.getHttpServer())
    .post("/auth/register-tenant")
    .send({
      email,
      password: PASSWORD,
      firstName: "Ana",
      lastName: "Pérez",
      locale: "es",
      ...body,
    })
    .expect(201);

  const mailer = app.get<NoopMailer>(MAILER);
  const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
  await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

  const creado = response.body as { tenantId: string; userId: string };
  return { ...creado, email };
}

describe("Los términos DORMIDOS (F11-SITE-LEGAL-02/03)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootApp(null);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("el alta SIN casilla sigue funcionando y no sella nada — la app se comporta como antes", async () => {
    const user = await registerActiveUser(app);

    const fila = await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { termsVersion: true, termsAcceptedAt: true },
      }),
    );

    expect(fila).toEqual({ termsVersion: null, termsAcceptedAt: null });
  });

  it("login y /me responden `mustAcceptTerms: false`: nadie ve el diálogo", async () => {
    const user = await registerActiveUser(app);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    expect(login.body.user.mustAcceptTerms).toBe(false);

    const me = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.mustAcceptTerms).toBe(false);
  });

  it("aceptar es un no-op que responde un OBJETO, nunca un cuerpo vacío", async () => {
    const user = await registerActiveUser(app);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    const response = await request(app.getHttpServer())
      .post("/auth/accept-terms")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(response.body).toEqual({ termsVersion: null, acceptedAt: null });
  });
});

describe("Los términos ENCENDIDOS (F11-SITE-LEGAL-02/03)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;

  beforeAll(async () => {
    app = await bootApp(VERSION_DE_PRUEBA);
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("el alta SIN casilla responde 400 con su clave y no crea el negocio", async () => {
    const email = `owner-${randomUUID()}@example.com`;

    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({ email, password: PASSWORD, firstName: "Ana", lastName: "Pérez", locale: "es" })
      .expect(400);

    expect(response.body.message).toBe(
      "Para crear tu cuenta necesitas aceptar los Términos y el Aviso de privacidad",
    );
    // Lo importante del 400: el correo queda LIBRE. Si el alta hubiera creado
    // el negocio antes de rechazar, el segundo intento chocaría con un 409.
    const huerfano = await prisma.user.findFirst({ where: { email } });
    expect(huerfano).toBeNull();
  });

  it("el alta CON la casilla crea el negocio y sella versión y fecha", async () => {
    const user = await registerActiveUser(app, { acceptTerms: true });

    const fila = await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { termsVersion: true, termsAcceptedAt: true },
      }),
    );

    expect(fila.termsVersion).toBe(VERSION_DE_PRUEBA);
    expect(fila.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it("quien se registró CON la casilla no vuelve a ver el diálogo", async () => {
    const user = await registerActiveUser(app, { acceptTerms: true });

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    expect(login.body.user.mustAcceptTerms).toBe(false);
  });

  /**
   * El caso REAL de F11-SITE-LEGAL-03: una cuenta creada ANTES de que los
   * términos existieran. Se fabrica con el alta dormida (`termsVersion` en
   * NULL, que es lo que tienen hoy todos los usuarios) y se le pega a la app
   * encendida.
   */
  it("quien ya tenía cuenta: /me lo avisa, POST /auth/accept-terms lo sella y no vuelve", async () => {
    const dormida = await bootApp(null);
    const user = await registerActiveUser(dormida);
    await dormida.close();

    const accessToken = tokenService.signAccessToken({
      sub: user.userId,
      tenantId: user.tenantId,
      permissions: [],
      locale: "es",
    });

    const antes = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(antes.body.mustAcceptTerms).toBe(true);

    const aceptacion = await request(app.getHttpServer())
      .post("/auth/accept-terms")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(aceptacion.body).toEqual({
      termsVersion: VERSION_DE_PRUEBA,
      acceptedAt: expect.any(String),
    });

    const despues = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(despues.body.mustAcceptTerms).toBe(false);

    // Y quedó escrito de verdad, no solo en la respuesta.
    const fila = await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { termsVersion: true },
      }),
    );
    expect(fila.termsVersion).toBe(VERSION_DE_PRUEBA);
  });

  it("aceptar dos veces no mueve la fecha: la constancia es de cuándo aceptó de verdad", async () => {
    const dormida = await bootApp(null);
    const user = await registerActiveUser(dormida);
    await dormida.close();

    const accessToken = tokenService.signAccessToken({
      sub: user.userId,
      tenantId: user.tenantId,
      permissions: [],
      locale: "es",
    });

    const primera = await request(app.getHttpServer())
      .post("/auth/accept-terms")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const segunda = await request(app.getHttpServer())
      .post("/auth/accept-terms")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(segunda.body.acceptedAt).toBe(primera.body.acceptedAt);
  });

  it("sin sesión no se acepta nada: 401", async () => {
    await request(app.getHttpServer()).post("/auth/accept-terms").expect(401);
  });
});
