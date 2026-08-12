import { type ExecutionContext, Injectable } from "@nestjs/common";
import type { I18nResolver } from "nestjs-i18n";
import { type RequestWithLocale, resolveLocale } from "./request-locale";

/**
 * F1-LOCALE-03: resolver custom que le dice a nestjs-i18n qué locale usar
 * para traducir la respuesta, siguiendo la MISMA cascada de F1-LOCALE-02
 * (user.locale -> Accept-Language -> DEFAULT_LOCALE).
 *
 * nestjs-i18n resuelve el idioma en un `I18nMiddleware` propio, registrado
 * globalmente por `I18nModule` — el orden respecto a `LocaleResolverMiddleware`
 * (también global, `'*'`) no está garantizado por la API pública de Nest.
 * Por eso este resolver NO asume que `req.locale` ya esté seteado: si está,
 * lo usa (fast path); si no, recalcula la cascada completa desde los headers
 * de la request. Es la MISMA función pura (`resolveLocale`), así que el
 * resultado es idéntico corra antes o después del middleware.
 *
 * Sin dependencias de constructor a propósito: nestjs-i18n resuelve
 * resolvers vía `moduleRef.get()` (strict, buscando solo en el propio
 * `I18nModule.forRoot()`), así que cualquier dependencia externa (ej.
 * TokenService) rompería el DI. Con cero deps, funciona igual en el
 * `I18nModule.forRoot()` completo de AppModule y en el módulo slim del e2e
 * de i18n (`test/i18n.e2e-spec.ts`) — ahí `req.locale` nunca está seteado
 * (no hay `LocaleResolverMiddleware`), así que este resolver recalcula desde
 * `Accept-Language`, dando el MISMO resultado que antes de este change.
 */
@Injectable()
export class RequestLocaleResolver implements I18nResolver {
  resolve(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest<RequestWithLocale>();
    return request.locale ?? resolveLocale(request);
  }
}
