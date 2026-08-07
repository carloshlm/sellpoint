import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";

/**
 * Smoke e2e (f1-auth U1-13): la app real bootea con Postgres (sellpoint_app,
 * RLS de verdad) + Redis + un par RS256 efímero (test/setup-env.js) — nada
 * mockeado. Esto es lo que corre en CI (checks.yml, servicios postgres:16 +
 * redis:7) y lo que prueba que el harness completo (env + guard global +
 * CryptoModule) está bien cableado ANTES de que exista ningún endpoint de
 * auth real (esos llegan en U2+).
 */
describe("AppModule (e2e smoke)", () => {
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

  it("GET /health responde 200 con Postgres y Redis reales", () => {
    return request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({ status: "ok", db: "ok", redis: "ok" });
  });

  it("GET /hello (ruta @Public()) responde sin necesitar JWT", () => {
    return request(app.getHttpServer()).get("/hello").expect(200);
  });

  it("secure by default: una ruta inexistente detrás del guard global sigue devolviendo 404, no 401 (Nest resuelve la ruta antes que el guard)", () => {
    return request(app.getHttpServer()).get("/no-existe").expect(404);
  });
});
