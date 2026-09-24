import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, registerTenant } from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-MANFIX-13 — el `:id` de las rutas del punto de venta.
 *
 * `GET /pos/quotes/<algo que no es uuid>` respondía 500: el id llegaba crudo a
 * Prisma, la columna es `uuid`, la conversión fallaba (P2023) y el filtro de
 * excepciones lo trataba como un error NUESTRO —500, y a Sentry—. Es un error
 * de quien llama: 400 con su clave, sin tocar la base. Vale para las seis
 * rutas con `:id` del controlador, no solo para la que salió en el manual.
 */
describe("El `:id` del punto de venta (F10-MANFIX-13)", () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    // La dueña: tiene `pos:quote`, `pos:view`, `pos:sell` y `pos:cancel`, así
    // que ningún 403 tapa lo que se prueba.
    ({ token } = await registerTenant(app, "pos-ids"));
  });

  afterAll(async () => {
    await app.close();
  });

  const pedir = (metodo: "GET" | "POST", ruta: string) =>
    metodo === "GET"
      ? request(app.getHttpServer()).get(ruta).set("Authorization", bearer(token))
      : request(app.getHttpServer())
          .post(ruta)
          .set("Authorization", bearer(token))
          // Un cuerpo VÁLIDO para las dos cancelaciones: el 400 tiene que ser
          // por el id, no por un motivo que falta.
          .send({ reason: "me equivoqué de folio" });

  it.each([
    ["GET", "/pos/quotes/no-es-un-uuid"],
    ["GET", "/pos/quotes/no-es-un-uuid/ticket"],
    ["POST", "/pos/quotes/no-es-un-uuid/cancel"],
    ["GET", "/pos/sales/no-es-un-uuid"],
    ["GET", "/pos/sales/no-es-un-uuid/ticket"],
    ["POST", "/pos/sales/no-es-un-uuid/cancel"],
  ] as const)("%s %s responde 400 con su clave, no 500", async (metodo, ruta) => {
    const res = await pedir(metodo, ruta).expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: "pos.invalid_id" });
  });

  /**
   * La validación no puede rechazar un id de verdad: un uuid bien formado que
   * no existe sigue siendo el 404 de siempre, el mismo que una cotización o
   * una venta de otro negocio.
   */
  it.each([
    ["/pos/quotes", "pos.quote_not_found"],
    ["/pos/sales", "pos.sale_not_found"],
  ])("un uuid bien formado que no existe en %s sigue siendo 404", async (base, clave) => {
    const res = await pedir("GET", `${base}/${randomUUID()}`).expect(404);

    expect(res.body).toMatchObject({ code: clave });
  });
});
