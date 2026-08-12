import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";

/**
 * e2e de F1-LOCALE-02/03: valida la INTEGRACIÓN real (LocaleResolverMiddleware
 * + RequestLocaleResolver + I18nModule montados en AppModule), no solo las
 * unidades aisladas. En particular, prueba que la rama "autenticado" de la
 * cascada (claim `locale` del Bearer token) le gana a `Accept-Language`
 * SIN asumir el orden de ejecución entre el middleware propio y el
 * middleware interno de nestjs-i18n (ver comentario en
 * request-locale.resolver.ts) — corre contra el AppModule real, tal cual
 * queda montado en producción.
 */
describe("Resolución de locale end-to-end (F1-LOCALE-02/03, e2e)", () => {
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

  function unsignedBearerWithLocale(locale: string): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ locale })).toString("base64url");
    return `Bearer ${header}.${payload}.firma-no-importa`;
  }

  it("sin token, Accept-Language: en -> /hello responde en inglés", () => {
    return request(app.getHttpServer())
      .get("/hello")
      .set("Accept-Language", "en")
      .expect(200)
      .expect("Hello");
  });

  it("con token cuyo claim locale=en, aunque Accept-Language sea es -> gana el locale del token", () => {
    return request(app.getHttpServer())
      .get("/hello")
      .set("Authorization", unsignedBearerWithLocale("en"))
      .set("Accept-Language", "es")
      .expect(200)
      .expect("Hello");
  });

  it("sin token ni Accept-Language -> DEFAULT_LOCALE (es)", () => {
    return request(app.getHttpServer()).get("/hello").expect(200).expect("Hola");
  });
});
