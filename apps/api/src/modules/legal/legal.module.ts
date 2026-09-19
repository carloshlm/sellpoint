import { Module } from "@nestjs/common";
import { CURRENT_TERMS_VERSION } from "@sellpoint/shared";
import { AuditModule } from "../audit/audit.module";
import { TERMS_VERSION, TermsService } from "./terms.service";

/**
 * F11-SITE-LEGAL — lo legal de SellPointy, en un módulo propio.
 *
 * Existe para que la versión vigente entre al árbol de DI en UN solo lugar.
 * `AuthModule` la necesita en el registro y en el login, `UsersModule` en
 * `GET /me`: si cada uno leyera la constante por su cuenta, encender los
 * términos dejaría de ser una línea y pasaría a ser una búsqueda.
 *
 * El provider es también la costura de los tests de integración:
 * sobrescribiéndolo se prueba el estado ENCENDIDO con una versión de mentira.
 *
 * ── Las e2e corren con los términos DORMIDOS ────────────────────────────
 * Mismo patrón que `THROTTLE_ENABLED` (test/setup-env.js): unas 50 suites dan
 * de alta negocios sin pensar en lo legal, y exigirles las dos casillas sería
 * probar lo mismo setenta veces. `legal-terms.e2e-spec.ts` lo prende por su
 * cuenta. La palanca SOLO existe con `NODE_ENV=test`: en producción no hay
 * variable de entorno que apague los términos — la única es la constante.
 */
function resolveTermsVersion(): string | null {
  if (process.env.NODE_ENV === "test" && process.env.TERMS_DORMANT_IN_TESTS === "true") {
    return null;
  }
  return CURRENT_TERMS_VERSION;
}

@Module({
  imports: [AuditModule],
  providers: [{ provide: TERMS_VERSION, useFactory: resolveTermsVersion }, TermsService],
  exports: [TermsService, TERMS_VERSION],
})
export class LegalModule {}
