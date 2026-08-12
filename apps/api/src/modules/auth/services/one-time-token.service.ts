import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface OneTimeToken {
  /** Valor en claro — SOLO viaja en el link del mail, nunca se persiste. */
  token: string;
  /** sha256 hex del token — lo único que se guarda en DB. */
  tokenHash: string;
}

/**
 * f1-auth design §2: mismo patrón para verify-email (U2) y password-reset
 * (U5). Token aleatorio de 256 bits — NO argon2 (AD-6): un token aleatorio
 * no tiene composición de baja entropía que fortalecer, y son rutas
 * calientes; argon2 se reserva para passwords.
 */
@Injectable()
export class OneTimeTokenService {
  generate(): OneTimeToken {
    const token = randomBytes(32).toString("base64url");
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
