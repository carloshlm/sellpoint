import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Env } from "../../config/env.schema";

export interface JwtKeyMaterial {
  privateKey: KeyObject;
  publicKeys: Map<string, KeyObject>;
  activeKid: string;
}

/**
 * f1-auth AD-4: resuelve el par RS256 y deriva el `kid` de la clave pública
 * (thumbprint estilo RFC 7638), no de una env var — así no se puede
 * desincronizar entre la clave y el kid.
 *
 * Resolución fail-closed: *_BASE64 gana → si no, *_PATH → si no, throw al
 * bootear. Nunca genera un par al vuelo.
 */
@Injectable()
export class JwtKeyProvider {
  private readonly material: JwtKeyMaterial;

  constructor(configService: ConfigService<Env, true>) {
    const privatePem = resolveKeyMaterial(
      configService.get("JWT_PRIVATE_KEY_BASE64", { infer: true }),
      configService.get("JWT_PRIVATE_KEY_PATH", { infer: true }),
      "JWT_PRIVATE_KEY",
    );
    const publicPem = resolveKeyMaterial(
      configService.get("JWT_PUBLIC_KEY_BASE64", { infer: true }),
      configService.get("JWT_PUBLIC_KEY_PATH", { infer: true }),
      "JWT_PUBLIC_KEY",
    );

    const privateKey = createPrivateKey(privatePem);
    const publicKey = createPublicKey(publicPem);
    const activeKid = deriveKid(publicKey);

    this.material = {
      privateKey,
      publicKeys: new Map([[activeKid, publicKey]]),
      activeKid,
    };
  }

  get(): JwtKeyMaterial {
    return this.material;
  }
}

function resolveKeyMaterial(
  base64: string | undefined,
  path: string | undefined,
  name: string,
): string {
  if (base64) {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  if (path) {
    return readFileSync(path, "utf-8");
  }
  throw new Error(
    `${name}_BASE64 o ${name}_PATH deben estar seteadas (fail-closed, ver AD-4 de sdd/f1-auth/design).`,
  );
}

function deriveKid(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64url").slice(0, 16);
}
