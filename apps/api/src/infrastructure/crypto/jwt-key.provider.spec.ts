import { generateKeyPairSync } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { JwtKeyProvider } from "./jwt-key.provider";

function generateKeyPairBase64() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return {
    privateBase64: Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    ).toString("base64"),
    publicBase64: Buffer.from(publicKey.export({ type: "spki", format: "pem" }) as string).toString(
      "base64",
    ),
  };
}

function configWith(overrides: Partial<Env>): ConfigService<Env, true> {
  const configService = new ConfigService<Env, true>(overrides);
  // ConfigService cae a process.env si no encuentra la key en internalConfig
  // — test/setup-env.js deja un par RS256 efímero seteado ahí para que el
  // resto de la suite pueda bootear AppModule. Sin este flag, los casos
  // "sin ninguna clave" de este archivo no podrían aislarse de ese default.
  // El setter es público en runtime pero el `.d.ts` lo marca `private` —
  // cast puntual para poder usarlo desde el test.
  (configService as unknown as { skipProcessEnv: boolean }).skipProcessEnv = true;
  return configService;
}

describe("JwtKeyProvider", () => {
  it("prioriza *_BASE64 sobre *_PATH cuando ambas están seteadas", () => {
    const pair = generateKeyPairBase64();

    const providerWithBogusPath = new JwtKeyProvider(
      configWith({
        JWT_PRIVATE_KEY_BASE64: pair.privateBase64,
        JWT_PUBLIC_KEY_BASE64: pair.publicBase64,
        // Rutas que no existen: si el provider intentara leerlas, esto
        // explotaría con ENOENT en vez de construirse bien.
        JWT_PRIVATE_KEY_PATH: "/no/existe/private.pem",
        JWT_PUBLIC_KEY_PATH: "/no/existe/public.pem",
      }),
    );

    const providerBase64Only = new JwtKeyProvider(
      configWith({
        JWT_PRIVATE_KEY_BASE64: pair.privateBase64,
        JWT_PUBLIC_KEY_BASE64: pair.publicBase64,
      }),
    );

    expect(providerWithBogusPath.get().activeKid).toBe(providerBase64Only.get().activeKid);
  });

  it("falla al construirse si no hay BASE64 ni PATH (fail-closed)", () => {
    expect(() => new JwtKeyProvider(configWith({}))).toThrow(/JWT_PRIVATE_KEY/);
  });

  it("falla al construirse si falta la clave pública", () => {
    const pair = generateKeyPairBase64();

    expect(
      () => new JwtKeyProvider(configWith({ JWT_PRIVATE_KEY_BASE64: pair.privateBase64 })),
    ).toThrow(/JWT_PUBLIC_KEY/);
  });

  it("el kid es estable entre instancias con la misma clave, y distinto para claves distintas", () => {
    const pairA = generateKeyPairBase64();
    const pairB = generateKeyPairBase64();

    const providerA1 = new JwtKeyProvider(
      configWith({
        JWT_PRIVATE_KEY_BASE64: pairA.privateBase64,
        JWT_PUBLIC_KEY_BASE64: pairA.publicBase64,
      }),
    );
    const providerA2 = new JwtKeyProvider(
      configWith({
        JWT_PRIVATE_KEY_BASE64: pairA.privateBase64,
        JWT_PUBLIC_KEY_BASE64: pairA.publicBase64,
      }),
    );
    const providerB = new JwtKeyProvider(
      configWith({
        JWT_PRIVATE_KEY_BASE64: pairB.privateBase64,
        JWT_PUBLIC_KEY_BASE64: pairB.publicBase64,
      }),
    );

    expect(providerA1.get().activeKid).toBe(providerA2.get().activeKid);
    expect(providerA1.get().activeKid).not.toBe(providerB.get().activeKid);
  });

  it("expone la clave pública activa en el mapa de publicKeys, indexada por su propio kid", () => {
    const pair = generateKeyPairBase64();

    const provider = new JwtKeyProvider(
      configWith({
        JWT_PRIVATE_KEY_BASE64: pair.privateBase64,
        JWT_PUBLIC_KEY_BASE64: pair.publicBase64,
      }),
    );

    const material = provider.get();
    expect(material.publicKeys.get(material.activeKid)).toBeDefined();
  });
});
