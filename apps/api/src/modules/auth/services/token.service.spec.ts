import { generateKeyPairSync } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import jwt from "jsonwebtoken";
import type { Env } from "../../../config/env.schema";
import { JwtKeyProvider } from "../../../infrastructure/crypto/jwt-key.provider";
import { AccessTokenClaims } from "../types/jwt-payload";
import { TokenService, TokenVerificationError } from "./token.service";

function generateKeyPairPem() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

const ISSUER = "sellpoint-api-test";
const AUDIENCE = "sellpoint-app-test";

function buildService() {
  const { privatePem, publicPem } = generateKeyPairPem();
  const configService = new ConfigService<Env, true>({
    JWT_PRIVATE_KEY_BASE64: Buffer.from(privatePem).toString("base64"),
    JWT_PUBLIC_KEY_BASE64: Buffer.from(publicPem).toString("base64"),
    JWT_ISSUER: ISSUER,
    JWT_AUDIENCE: AUDIENCE,
    JWT_ACCESS_TTL_MIN: 15,
  });
  const keyProvider = new JwtKeyProvider(configService);
  const service = new TokenService(keyProvider, configService);

  return { service, kid: keyProvider.get().activeKid, privatePem, publicPem };
}

const claims: AccessTokenClaims = {
  sub: "user-1",
  tenantId: "tenant-1",
  permissions: ["sales:create"],
  locale: "es",
};

describe("TokenService", () => {
  it("roundtrip: firma y verifica, devuelve los claims correctos", () => {
    const { service } = buildService();

    const token = service.signAccessToken(claims);
    const payload = service.verifyAccessToken(token);

    expect(payload.sub).toBe(claims.sub);
    expect(payload.tenantId).toBe(claims.tenantId);
    expect(payload.permissions).toEqual(claims.permissions);
    expect(payload.locale).toBe(claims.locale);
    expect(payload.iss).toBe(ISSUER);
    expect(payload.aud).toBe(AUDIENCE);
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
  });

  it("el header del token trae el kid activo y alg RS256", () => {
    const { service, kid } = buildService();

    const token = service.signAccessToken(claims);
    const [headerB64] = token.split(".");
    const header = JSON.parse(Buffer.from(headerB64 ?? "", "base64url").toString("utf-8"));

    expect(header.kid).toBe(kid);
    expect(header.alg).toBe("RS256");
  });

  it("rechaza alg=none", () => {
    const { service } = buildService();

    const token = service.signAccessToken(claims);
    const [, payloadB64] = token.split(".");
    const forgedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const forged = `${forgedHeader}.${payloadB64}.`;

    expect(() => service.verifyAccessToken(forged)).toThrow(TokenVerificationError);
  });

  it("rechaza un token firmado HS256 usando la clave pública como secreto (algorithm confusion)", () => {
    const { service, kid, publicPem } = buildService();

    const forged = jwt.sign(claims, publicPem, {
      algorithm: "HS256",
      keyid: kid,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: "15m",
    });

    expect(() => service.verifyAccessToken(forged)).toThrow(TokenVerificationError);
  });

  it("rechaza un token expirado", () => {
    const { service, kid, privatePem } = buildService();

    const forged = jwt.sign(claims, privatePem, {
      algorithm: "RS256",
      keyid: kid,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: "-1s",
    });

    expect(() => service.verifyAccessToken(forged)).toThrow(TokenVerificationError);
  });

  it("rechaza un issuer distinto al configurado", () => {
    const { service, kid, privatePem } = buildService();

    const forged = jwt.sign(claims, privatePem, {
      algorithm: "RS256",
      keyid: kid,
      issuer: "issuer-atacante",
      audience: AUDIENCE,
      expiresIn: "15m",
    });

    expect(() => service.verifyAccessToken(forged)).toThrow(TokenVerificationError);
  });

  it("rechaza una audience distinta a la configurada", () => {
    const { service, kid, privatePem } = buildService();

    const forged = jwt.sign(claims, privatePem, {
      algorithm: "RS256",
      keyid: kid,
      issuer: ISSUER,
      audience: "audience-atacante",
      expiresIn: "15m",
    });

    expect(() => service.verifyAccessToken(forged)).toThrow(TokenVerificationError);
  });

  it("rechaza un token con la firma alterada", () => {
    const { service } = buildService();

    const token = service.signAccessToken(claims);
    const parts = token.split(".");
    // Un JWT son SIEMPRE tres partes: afirmarlo antes de tocar la firma evita
    // que un cambio en el formato del token convierta esto en un test que
    // altera `undefined` y sigue pasando.
    expect(parts).toHaveLength(3);
    const signature = parts[2] ?? "";
    // Alterar un char cerca del FINAL de una firma RSA-2048 (256 bytes ≡ 1
    // mod 3) es un no-op: los últimos 4 bits del último sexteto base64url
    // son padding puro, ignorados al decodificar — no cambian los bytes
    // reales de la firma. Tocamos un char bien adentro para garantizar que
    // sí mueve bits significativos.
    const index = 10;
    const original = signature[index];
    const replacement = original === "A" ? "B" : "A";
    parts[2] = signature.slice(0, index) + replacement + signature.slice(index + 1);

    expect(() => service.verifyAccessToken(parts.join("."))).toThrow(TokenVerificationError);
  });

  it("rechaza un kid desconocido", () => {
    const { service, privatePem } = buildService();

    const forged = jwt.sign(claims, privatePem, {
      algorithm: "RS256",
      keyid: "kid-que-no-existe",
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: "15m",
    });

    expect(() => service.verifyAccessToken(forged)).toThrow(TokenVerificationError);
  });
});
