// Defaults de entorno para tests (CI no tiene .env — jest los carga ANTES de
// cualquier import, que es cuando ConfigModule.forRoot valida).
//
// f1-auth R1/U1-12: el runtime de la API SIEMPRE conecta como sellpoint_app
// (sin privilegios, sujeto a RLS de verdad) — NUNCA como el superuser
// `sellpoint`. Si este default vuelve a apuntar al superuser, los tests de
// integración/RLS "pasan" sin probar nada (canario en prisma.service.spec.ts).
process.env.DATABASE_URL ??=
  "postgresql://sellpoint_app:sellpoint_app@localhost:5432/sellpoint_dev";
process.env.REDIS_URL ??= "redis://localhost:6379";

// f1-auth U6-02: apagado por defecto en TODA la suite (unit + e2e) — sin
// esto, los ~50 tests e2e existentes que pegan repetidas veces a /auth/*
// desde la misma IP de test tropezarían con el límite de 5/15min (auth-ip)
// y la suite completa se rompería por contaminación cruzada entre archivos.
// La suite de throttling (test/e2e/auth-throttling.e2e-spec.ts) lo prende
// explícitamente en su propio beforeAll/afterAll (design §8: "THROTTLE_
// ENABLED=false salvo en la suite de throttling").
process.env.THROTTLE_ENABLED ??= "false";

// f1-auth U1-06: obligatoria en env.schema.ts, sin default de producción —
// pero los tests sí necesitan un valor válido para que ConfigModule.forRoot
// no explote al bootear AppModule.
process.env.REFRESH_COOKIE_PATH ??= "/auth";

// f1-auth U1-07/AD-4: par RS256 efímero, uno por proceso de test worker.
// Nunca se commitea nada — se genera en memoria y se vuelca a base64, igual
// que el globalSetup del harness e2e (test/e2e/global-setup.ts).
if (!process.env.JWT_PRIVATE_KEY_BASE64 || !process.env.JWT_PUBLIC_KEY_BASE64) {
  const { generateKeyPairSync } = require("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  process.env.JWT_PRIVATE_KEY_BASE64 = Buffer.from(
    privateKey.export({ type: "pkcs8", format: "pem" }),
  ).toString("base64");
  process.env.JWT_PUBLIC_KEY_BASE64 = Buffer.from(
    publicKey.export({ type: "spki", format: "pem" }),
  ).toString("base64");
}
