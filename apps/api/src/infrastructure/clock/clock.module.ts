import { Global, Module } from "@nestjs/common";
import { CLOCK } from "./clock.port";
import { SystemClock } from "./system.clock";

// @Global: CLOCK es transversal (TTLs de tokens de un solo uso, throttle,
// epochs) — mismo criterio que CryptoModule (f1-auth design §2). Faltaba
// wiring de DI para el puerto creado en U1 (U1-08 dejó el archivo pero
// ningún módulo lo registraba); U2 lo necesita para OneTimeTokenService.
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
