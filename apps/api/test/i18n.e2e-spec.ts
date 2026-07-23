import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { I18nModule } from "nestjs-i18n";
import request from "supertest";
import type { App } from "supertest/types";
import { i18nOptions } from "../src/i18n/i18n.config";
import { I18nDemoController } from "../src/i18n/i18n-demo.controller";

describe("i18n (e2e)", () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [I18nModule.forRoot(i18nOptions)],
      controllers: [I18nDemoController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("responde en español cuando Accept-Language: es", () => {
    return request(app.getHttpServer())
      .get("/hello")
      .set("Accept-Language", "es")
      .expect(200)
      .expect("Hola");
  });

  it("responde en inglés cuando Accept-Language: en", () => {
    return request(app.getHttpServer())
      .get("/hello")
      .set("Accept-Language", "en")
      .expect(200)
      .expect("Hello");
  });

  it("cae al locale por defecto cuando Accept-Language no está soportado", () => {
    return request(app.getHttpServer())
      .get("/hello")
      .set("Accept-Language", "fr")
      .expect(200)
      .expect("Hola");
  });

  it("cae al locale por defecto cuando no hay header Accept-Language", () => {
    return request(app.getHttpServer()).get("/hello").expect(200).expect("Hola");
  });
});
