import { Global, Module } from "@nestjs/common";
import { Argon2Hasher } from "./argon2.hasher";
import { HASHER } from "./hash.port";
import { JwtKeyProvider } from "./jwt-key.provider";

// @Global: f1-rbac también va a necesitar hashear passwords al aceptar
// invitaciones — un puerto transversal evita que rbac tenga que importar de
// auth (design §2).
@Global()
@Module({
  providers: [
    JwtKeyProvider,
    {
      provide: HASHER,
      useClass: Argon2Hasher,
    },
  ],
  exports: [JwtKeyProvider, HASHER],
})
export class CryptoModule {}
