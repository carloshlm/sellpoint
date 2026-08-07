import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Env } from "../../../config/env.schema";
import { JwtKeyProvider } from "../../../infrastructure/crypto/jwt-key.provider";
import { AccessTokenClaims, JwtPayload } from "../types/jwt-payload";

export class TokenVerificationError extends Error {}

/**
 * Firma/verifica el access token RS256 (f1-auth AD-4). Sin Passport
 * (D2 del proposal): `@nestjs/jwt` como librería standalone, config
 * explícita por-llamada — no hay un único secreto global, hay un mapa de
 * claves públicas por kid.
 */
@Injectable()
export class TokenService {
  private readonly jwtService = new JwtService();
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTtlMin: number;

  constructor(
    private readonly keyProvider: JwtKeyProvider,
    configService: ConfigService<Env, true>,
  ) {
    this.issuer = configService.get("JWT_ISSUER", { infer: true });
    this.audience = configService.get("JWT_AUDIENCE", { infer: true });
    this.accessTtlMin = configService.get("JWT_ACCESS_TTL_MIN", { infer: true });
  }

  signAccessToken(claims: AccessTokenClaims): string {
    const { privateKey, activeKid } = this.keyProvider.get();

    return this.jwtService.sign(claims, {
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      algorithm: "RS256",
      keyid: activeKid,
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: `${this.accessTtlMin}m`,
    });
  }

  verifyAccessToken(token: string): JwtPayload {
    const decoded = this.jwtService.decode(token, { complete: true }) as {
      header?: { kid?: string };
    } | null;
    const kid = decoded?.header?.kid;
    const publicKey = kid ? this.keyProvider.get().publicKeys.get(kid) : undefined;

    if (!publicKey) {
      throw new TokenVerificationError("kid desconocido, ausente o token malformado");
    }

    try {
      // algorithms fijo a ['RS256'] es la defensa contra algorithm
      // confusion: aunque el header del token diga otra cosa (none, HS256
      // firmado con la pública), jsonwebtoken rechaza si no matchea esta
      // lista — sin importar lo que declare el header.
      return this.jwtService.verify<JwtPayload>(token, {
        publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
        algorithms: ["RS256"],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: 0,
      });
    } catch (error) {
      throw new TokenVerificationError(error instanceof Error ? error.message : "token inválido");
    }
  }
}
