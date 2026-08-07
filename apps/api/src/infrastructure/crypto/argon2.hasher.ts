import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { HashPort } from "./hash.port";

// Contrato duro (f1-auth AD-1 + R5 del design): memoryCost=19456 casa con
// mem_limit: 512M del compose de prod (256 de heap + young gen + buffers +
// argon2id). Subir esto (ej. al default 65536) OOM-kilea la api bajo
// concurrencia real. NUNCA leer estos valores de env — el test canario de
// argon2.hasher.spec.ts rompe si alguien intenta parametrizarlos.
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class Argon2Hasher implements HashPort {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
