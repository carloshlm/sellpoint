import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { type RequestWithLocale, resolveLocale } from "./request-locale";

/**
 * F1-LOCALE-02: middleware global que setea `req.locale` con la cascada de
 * `resolveLocale` (user.locale -> Accept-Language -> DEFAULT_LOCALE). Se
 * registra para `'*'` en `AppModule.configure()` — corre en TODA request,
 * autenticada o no, porque decodifica el claim `locale` del Bearer token sin
 * depender de que `JwtAuthGuard` ya haya corrido (los middlewares corren
 * antes que los guards en el pipeline de Nest).
 *
 * Consumido directo por código de dominio que necesite el locale resuelto
 * sin pasar por nestjs-i18n (ver `getLocale(req)` en request-locale.ts) — el
 * resolver custom de F1-LOCALE-03 (`RequestLocaleResolver`) hace la MISMA
 * cascada de forma independiente (no asume orden de middlewares respecto al
 * de nestjs-i18n), así que este middleware no es un prerrequisito estricto
 * de la traducción, solo de `req.locale` como dato de request.
 */
@Injectable()
export class LocaleResolverMiddleware implements NestMiddleware {
  use(req: Request & RequestWithLocale, _res: Response, next: NextFunction): void {
    req.locale = resolveLocale(req);
    next();
  }
}
