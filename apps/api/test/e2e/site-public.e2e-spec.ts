import { randomBytes, randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { startTestApp } from "./support/start-test-app";

/**
 * F11-SITE-LEAD-06 / F11-SITE-SEO-06 — los dos endpoints públicos del sitio,
 * de punta a punta.
 *
 * Lo que este archivo custodia, y que ninguna prueba unitaria puede: que el
 * formulario responda SIEMPRE el mismo 202 salvo cuando el cuerpo está mal
 * formado, que lo atrapado por las trampas no deje fila, y que el beacon
 * acepte el `text/plain` que manda `navigator.sendBeacon`.
 *
 * El throttle se prende con `ConfigService#set()` después de `app.init()` y
 * cada caso usa una IP sintética ÚNICA y aleatoria: los contadores viven en
 * Redis con TTL de hasta una hora, así que una IP fija heredaría los hits de
 * la corrida anterior (misma lección que `auth-throttling.e2e-spec.ts`).
 */
describe("Los endpoints públicos del sitio (F11-SITE)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let mailer: NoopMailer;
  const creados: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Replica main.ts: sin esto Express ignora X-Forwarded-For y todas las
    // IPs «distintas» de este archivo colapsarían en una sola.
    app.set("trust proxy", 1);
    await startTestApp(app);

    prisma = app.get(PrismaService);
    mailer = app.get<NoopMailer>(MAILER);
    app.get(ConfigService).set("BILLING_ADMIN_EMAILS", "carls.hlm@gmail.com, otro@sellpointy.com");
  });

  afterAll(async () => {
    await prisma.siteLead.deleteMany({ where: { email: { in: creados } } });
    await prisma.siteEvent.deleteMany({ where: { section: { startsWith: "e2e-" } } });
    await app.close();
  });

  function ipUnica(): string {
    const octetos = randomBytes(3);
    return `10.${octetos[0]}.${octetos[1]}.${octetos[2]}`;
  }

  function correoUnico(): string {
    const email = `prospecto-${randomUUID()}@example.com`;
    creados.push(email);
    return email;
  }

  function cuerpo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: "Ana Pérez",
      email: correoUnico(),
      country: "MX",
      locale: "es",
      route: "es-mx",
      planInterest: "pro",
      businessType: "Abarrotes",
      message: "Quiero saber más de SellPointy.",
      sourceUrl: "https://sellpointy.com/es-mx/",
      consent: true,
      consentText: "Acepto el aviso de privacidad.",
      elapsedMs: 12_000,
      ...overrides,
    };
  }

  describe("POST /public/leads", () => {
    it("alta feliz: 202, fila guardada, aviso con Reply-To y acuse en el idioma", async () => {
      const antes = mailer.sent.length;
      const body = cuerpo();

      await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ipUnica())
        .send(body)
        .expect(202)
        .expect({ received: true });

      const fila = await prisma.siteLead.findFirst({ where: { email: body.email as string } });
      expect(fila).toMatchObject({
        name: "Ana Pérez",
        country: "MX",
        locale: "es",
        route: "es-mx",
        planInterest: "pro",
        businessType: "Abarrotes",
        consentText: "Acepto el aviso de privacidad.",
      });
      // Se avisó: `notified_at` sellado es lo que el backoffice pinta como
      // «avisado», y su NULL es la red para el día que un correo no salga.
      expect(fila?.notifiedAt).not.toBeNull();

      const nuevos = mailer.sent.slice(antes);
      const avisos = nuevos.filter((m) => m.template === "site-lead");
      expect(avisos.map((m) => m.to).sort()).toEqual([
        "carls.hlm@gmail.com",
        "otro@sellpointy.com",
      ]);
      expect(avisos[0]).toMatchObject({ locale: "es", replyTo: body.email });

      const acuse = nuevos.find((m) => m.template === "site-lead-reply");
      expect(acuse).toMatchObject({ to: body.email, locale: "es" });
    });

    it("el acuse va en FRANCÉS cuando escribió desde /fr-ca/", async () => {
      const antes = mailer.sent.length;
      const body = cuerpo({ locale: "fr", route: "fr-ca", country: "CA" });

      await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ipUnica())
        .send(body)
        .expect(202);

      const acuse = mailer.sent.slice(antes).find((m) => m.template === "site-lead-reply");
      expect(acuse).toMatchObject({ locale: "fr" });
    });

    it("un correo inválido responde 400: el formulario real necesita saberlo", async () => {
      await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ipUnica())
        .send(cuerpo({ email: "ana@" }))
        .expect(400);
    });

    it("sin marcar el consentimiento: 400", async () => {
      await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ipUnica())
        .send(cuerpo({ consent: false }))
        .expect(400);
    });

    it("la trampa llena: 202 idéntico y SIN fila", async () => {
      const body = cuerpo({ website: "http://spam.example" });

      await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ipUnica())
        .send(body)
        .expect(202)
        .expect({ received: true });

      expect(await prisma.siteLead.count({ where: { email: body.email as string } })).toBe(0);
    });

    it("enviado demasiado rápido: 202 idéntico y SIN fila", async () => {
      const body = cuerpo({ elapsedMs: 150 });

      await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ipUnica())
        .send(body)
        .expect(202)
        .expect({ received: true });

      expect(await prisma.siteLead.count({ where: { email: body.email as string } })).toBe(0);
    });

    /** El correo repetido responde IGUAL: si no, el endpoint diría quién ya escribió. */
    it("el mismo correo dos veces responde exactamente lo mismo", async () => {
      const email = correoUnico();

      for (const _ of [1, 2]) {
        await request(app.getHttpServer())
          .post("/public/leads")
          .set("X-Forwarded-For", ipUnica())
          .send(cuerpo({ email }))
          .expect(202)
          .expect({ received: true });
      }

      expect(await prisma.siteLead.count({ where: { email } })).toBe(2);
    });
  });

  describe("POST /public/site-events", () => {
    it("acepta el beacon como text/plain, que es lo que manda sendBeacon sin preflight", async () => {
      await request(app.getHttpServer())
        .post("/public/site-events")
        .set("X-Forwarded-For", ipUnica())
        .set("Content-Type", "text/plain;charset=UTF-8")
        .send(
          JSON.stringify({
            event: "cta_click",
            market: "mx",
            locale: "es",
            section: "e2e-hero",
            referrerDomain: "https://www.google.com/search?q=punto+de+venta",
          }),
        )
        .expect(202)
        .expect({ received: true });

      const fila = await prisma.siteEvent.findFirst({ where: { section: "e2e-hero" } });
      expect(fila).toMatchObject({ event: "cta_click", market: "mx", locale: "es" });
      // El dominio, nunca la URL: la query de un buscador lleva lo que la
      // persona escribió.
      expect(fila?.referrerDomain).toBe("google.com");
    });

    it("también acepta application/json, por si el sitio prefiere el Blob tipado", async () => {
      await request(app.getHttpServer())
        .post("/public/site-events")
        .set("X-Forwarded-For", ipUnica())
        .send({ event: "form_open", market: "us", locale: "en", section: "e2e-json", plan: "pro" })
        .expect(202);

      expect(await prisma.siteEvent.count({ where: { section: "e2e-json" } })).toBe(1);
    });

    it("un evento desconocido: 202 y SIN fila — nunca 400, el beacon no lo leería", async () => {
      await request(app.getHttpServer())
        .post("/public/site-events")
        .set("X-Forwarded-For", ipUnica())
        .send({ event: "scroll_depth", market: "mx", locale: "es", section: "e2e-desconocido" })
        .expect(202)
        .expect({ received: true });

      expect(await prisma.siteEvent.count({ where: { section: "e2e-desconocido" } })).toBe(0);
    });

    it("un text/plain que no es JSON tampoco rompe nada", async () => {
      await request(app.getHttpServer())
        .post("/public/site-events")
        .set("X-Forwarded-For", ipUnica())
        .set("Content-Type", "text/plain")
        .send("esto no es json")
        .expect(202)
        .expect({ received: true });
    });
  });

  describe("el límite por IP (LEAD-03)", () => {
    beforeAll(() => {
      app.get(ConfigService).set("THROTTLE_ENABLED", true);
    });

    afterAll(() => {
      app.get(ConfigService).set("THROTTLE_ENABLED", false);
    });

    it("el 6º mensaje de la misma IP en una hora: 429 con el mensaje del sitio", async () => {
      const ip = ipUnica();

      for (let intento = 1; intento <= 5; intento += 1) {
        await request(app.getHttpServer())
          .post("/public/leads")
          .set("X-Forwarded-For", ip)
          .send(cuerpo())
          .expect(202);
      }

      const rebotado = await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ip)
        .send(cuerpo())
        .expect(429);

      expect(rebotado.body).toMatchObject({ code: "site.too_many_requests" });
      expect(rebotado.body.message).toContain("Recibimos varios mensajes");
    });

    /** El presupuesto de eventos es OTRO balde: medir no gasta el del formulario. */
    it("los eventos no consumen el presupuesto del formulario", async () => {
      const ip = ipUnica();

      for (let intento = 1; intento <= 10; intento += 1) {
        await request(app.getHttpServer())
          .post("/public/site-events")
          .set("X-Forwarded-For", ip)
          .send({ event: "plans_expand", market: "mx", locale: "es", section: "e2e-balde" })
          .expect(202);
      }

      await request(app.getHttpServer())
        .post("/public/leads")
        .set("X-Forwarded-For", ip)
        .send(cuerpo())
        .expect(202);
    });
  });
});
