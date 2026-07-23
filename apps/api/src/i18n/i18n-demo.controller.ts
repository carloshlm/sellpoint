import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { I18n, type I18nContext } from "nestjs-i18n";

/**
 * Canary de wiring de i18n (F0-I18N-03), análogo a HealthController para
 * infra: si esta ruta responde el string traducido correcto, confirma que
 * el resolver de locale + el loader de JSON siguen cableados tras refactors.
 * No es un residuo del scaffold de Nest: queda permanente a propósito.
 */
@ApiTags("i18n")
@Controller()
export class I18nDemoController {
  @Get("hello")
  getHello(@I18n() i18n: I18nContext): string {
    return i18n.t("common.hello");
  }
}
