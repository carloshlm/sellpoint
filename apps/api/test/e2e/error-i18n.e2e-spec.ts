import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";

/**
 * verify #271 C2 + decisión de Carlos (`sdd/f1-auth/decisions-carlos`): el
 * BACKEND traduce los errores. `AllExceptionsFilter` debe resolver el
 * locale de la request (cascada de `LocaleResolverMiddleware`,
 * F1-LOCALE-02: user.locale -> Accept-Language -> default) y devolver
 * `message` TRADUCIDO, con `code` conservando la clave i18n cruda para que
 * el front pueda discriminar sin parsear texto (AUTH-REQ-14,
 * ARQUITECTURA.md:851).
 *
 * Antes del fix: `AllExceptionsFilter` nunca llamaba a
 * `I18nService.translate()` — devolvía la clave cruda (`auth.missing_token`)
 * IDÉNTICA en `es` y en `en`. Los 15 mensajes de
 * `src/i18n/{es,en}/auth.json` eran código muerto para errores.
 */
describe("i18n de errores en AllExceptionsFilter (e2e) — verify #271 C2", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("el MISMO error (401 auth.missing_token) responde texto DISTINTO en es vs en, y expone `code` con la clave cruda", async () => {
    const es = await request(app.getHttpServer())
      .patch("/me")
      .set("Accept-Language", "es")
      .send({})
      .expect(401);

    const en = await request(app.getHttpServer())
      .patch("/me")
      .set("Accept-Language", "en")
      .send({})
      .expect(401);

    expect(es.body).toMatchObject({
      code: "auth.missing_token",
      message: "Falta el token de autenticación",
    });
    expect(en.body).toMatchObject({
      code: "auth.missing_token",
      message: "Missing authentication token",
    });
    expect(es.body.message).not.toBe(en.body.message);
  });

  it("mismo error, sin Accept-Language: cae al DEFAULT_LOCALE (es), no a la clave cruda", async () => {
    const response = await request(app.getHttpServer()).patch("/me").send({}).expect(401);

    expect(response.body).toMatchObject({
      code: "auth.missing_token",
      message: "Falta el token de autenticación",
    });
  });

  it("401 auth.invalid_token (Bearer basura) también se traduce en ambos idiomas", async () => {
    const es = await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", "Bearer basura")
      .set("Accept-Language", "es")
      .send({})
      .expect(401);
    const en = await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", "Bearer basura")
      .set("Accept-Language", "en")
      .send({})
      .expect(401);

    expect(es.body).toMatchObject({
      code: "auth.invalid_token",
      message: "El token de autenticación no es válido",
    });
    expect(en.body).toMatchObject({
      code: "auth.invalid_token",
      message: "Invalid authentication token",
    });
  });
});
