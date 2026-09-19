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
 * El `useValue` con la constante es también la costura de los tests de
 * integración: sobrescribiendo este provider se prueba el estado ENCENDIDO
 * sin publicar una versión de verdad.
 */
@Module({
  imports: [AuditModule],
  providers: [{ provide: TERMS_VERSION, useValue: CURRENT_TERMS_VERSION }, TermsService],
  exports: [TermsService, TERMS_VERSION],
})
export class LegalModule {}
