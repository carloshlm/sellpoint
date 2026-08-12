import { randomBytes, randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";

const PASSWORD = "twelve-characters";

/**
 * e2e de U6-02 (f1-auth): AUTH-REQ-12 — throttling de `/auth/*` con Redis
 * real (contadores CON TTL, contrato AUTH-REQ-17).
 *
 * Aislamiento (design §8: "THROTTLE_ENABLED=false salvo en la suite de
 * throttling"): `THROTTLE_ENABLED` se lee UNA sola vez, de forma síncrona,
 * en el momento en que `AppModule` importa `ConfigModule.forRoot(...)`
 * (`test/setup-env.js` ya lo dejó en "false" para el resto de la suite) —
 * mutar `process.env` DESPUÉS de ese import no tiene efecto porque el
 * config queda validado y congelado en el `ConfigService`. Por eso acá se
 * prende con `ConfigService#set()` (API pública de @nestjs/config para
 * overrides en runtime, escribe en `internalConfig`, que `get()` consulta
 * ANTES que el env validado) después de `app.init()`. Cada test usa IPs
 * sintéticas ÚNICAS (`X-Forwarded-For` + `trust proxy`) y/o emails únicos
 * (`randomUUID()`) para no compartir contadores entre tests — así no hace
 * falta FLUSHDB del Redis compartido del harness. IMPORTANTE: las IPs se
 * generan con `randomBytes` (no un contador secuencial desde 0) porque los
 * contadores en Redis tienen TTL de hasta 1h (auth-email) — un contador
 * secuencial reproduciría LAS MISMAS keys (`throttle:auth-ip:10.0.0.1`, …)
 * en cada corrida del test runner dentro de esa ventana, y la corrida N+1
 * heredaría los hits de la corrida N (falsos positivos de 429 desde el
 * primer intento). Con bytes aleatorios, cada corrida usa direcciones
 * distintas y no hay colisión posible con runs anteriores.
 */
describe("Throttling de /auth/* (e2e)", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Replica main.ts (AD-7): sin esto, Express ignora X-Forwarded-For y
    // request.ip siempre resuelve al socket local — todas las IPs
    // "distintas" de este archivo colapsarían en una sola.
    app.set("trust proxy", 1);
    await app.init();

    app.get(ConfigService).set("THROTTLE_ENABLED", true);
  });

  afterAll(async () => {
    await app.close();
  });

  function nextFakeIp(): string {
    const octets = randomBytes(3);
    return `10.${octets[0]}.${octets[1]}.${octets[2]}`;
  }

  function uniqueEmail(): string {
    return `owner-${randomUUID()}@example.com`;
  }

  function loginAttempt(email: string, ip: string, password = "password-incorrecta") {
    return request(app.getHttpServer())
      .post("/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email, password });
  }

  it("auth-ip: el 6º intento desde la MISMA IP → 429 auth.too_many_attempts (los 5 previos no se bloquean)", async () => {
    const ip = nextFakeIp();

    for (let i = 0; i < 5; i += 1) {
      // Email distinto en cada intento: aísla esta prueba de la dimensión
      // auth-email, solo debe contar el límite de IP.
      const res = await loginAttempt(uniqueEmail(), ip);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "auth.invalid_credentials" });
    }

    const blocked = await loginAttempt(uniqueEmail(), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "auth.too_many_attempts" });
  });

  it("auth-ip: dos IPs independientes tienen contadores propios — una bloqueada no afecta a la otra", async () => {
    const ipA = nextFakeIp();
    const ipB = nextFakeIp();

    for (let i = 0; i < 5; i += 1) {
      await loginAttempt(uniqueEmail(), ipA).then((r) => expect(r.status).toBe(401));
    }
    await loginAttempt(uniqueEmail(), ipA).then((r) => expect(r.status).toBe(429));

    // ipB nunca tocada: sigue respondiendo 401 normal, NO 429.
    const fromB = await loginAttempt(uniqueEmail(), ipB);
    expect(fromB.status).toBe(401);
  });

  it("auth-email: el 11º intento con el MISMO email (desde IPs distintas) → 429 auth.too_many_attempts", async () => {
    const email = uniqueEmail();

    for (let i = 0; i < 10; i += 1) {
      const res = await loginAttempt(email, nextFakeIp());
      expect(res.status).toBe(401);
    }

    const blocked = await loginAttempt(email, nextFakeIp());
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "auth.too_many_attempts" });
  });

  it("forgot-password también cuenta contra auth-email (mismo email, IPs distintas)", async () => {
    const email = uniqueEmail();

    for (let i = 0; i < 10; i += 1) {
      await request(app.getHttpServer())
        .post("/auth/forgot-password")
        .set("X-Forwarded-For", nextFakeIp())
        .send({ email })
        .expect(202);
    }

    const blocked = await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .set("X-Forwarded-For", nextFakeIp())
      .send({ email });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "auth.too_many_attempts" });
  });

  it("register-tenant NO aplica auth-email (scope explícito login+forgot-password) — se bloquea por IP en el 6º intento, nunca antes por email", async () => {
    const ip = nextFakeIp();
    let blockedAtIndex = -1;

    for (let i = 0; i < 6; i += 1) {
      const res = await request(app.getHttpServer())
        .post("/auth/register-tenant")
        .set("X-Forwarded-For", ip)
        .send({
          tenantName: `Acme ${randomUUID()}`,
          email: uniqueEmail(),
          password: PASSWORD,
          firstName: "Ana",
          lastNamePaternal: "Pérez",
          locale: "es",
        });

      if (res.status === 429) {
        blockedAtIndex = i;
        break;
      }
      expect(res.status).toBe(201);
    }

    // 5 registros pasan (índices 0-4), el 6to (índice 5) es el primero
    // bloqueado — confirma que el límite que actuó fue auth-ip (5), no
    // auth-email (10, y ni siquiera aplica acá).
    expect(blockedAtIndex).toBe(5);
  });
});
