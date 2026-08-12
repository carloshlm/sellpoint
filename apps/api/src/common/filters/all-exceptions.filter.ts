import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { I18nService } from "nestjs-i18n";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";

const STATUS_TEXT: Record<number, string> = Object.fromEntries(
  Object.entries(HttpStatus)
    .filter(([, value]) => typeof value === "number")
    .map(([name, value]) => [
      value,
      name
        .toLowerCase()
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    ]),
);

// Convención del proyecto (ver zod-validation.pipe.ts, jwt-auth.guard.ts,
// auth.service.ts, etc.): TODO `message` que es una clave i18n cruda tiene
// forma `namespace.key` (minúsculas + guion bajo). Mensajes libres de Nest
// (ej. `new NotFoundException("Producto no encontrado")`) NUNCA matchean
// este patrón, así que pasan sin traducir.
const I18N_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * AUTH-REQ-14 / decisión de Carlos (`sdd/f1-auth/decisions-carlos`,
 * resolviendo verify #271 C2): el BACKEND traduce los errores. Acá, y no en
 * el front, porque la infra i18n (LocaleResolverMiddleware + JSONs es/en de
 * F1-LOCALE) ya sirve a cualquier cliente de la API, no solo a la SPA.
 *
 * Se resuelve el locale con `getLocale(request)` (mismo helper que consume
 * `RequestLocaleResolver` de nestjs-i18n) en vez de `I18nContext.current()`
 * porque un `ExceptionFilter` corre fuera del ciclo de vida normal de
 * interceptors/pipes donde nestjs-i18n bindea el contexto — el locale YA
 * está resuelto por request (`LocaleResolverMiddleware`, montado con `'*'`
 * en `AppModule.configure()`, corre ANTES que cualquier guard).
 *
 * Contrato de respuesta: `message` queda TRADUCIDO; `code` conserva la
 * clave cruda para que el front discrimine sin parsear texto.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & RequestWithLocale>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = STATUS_TEXT[statusCode] ?? "Error";

    let body: Record<string, unknown>;

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      body =
        typeof payload === "string"
          ? { statusCode, message: payload, error }
          : { statusCode, error, ...payload };
    } else {
      this.logger.error(
        `Unhandled exception en ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      body = {
        statusCode,
        message: "Internal server error",
        error,
      };
    }

    body = this.translateIfKey(body, request);

    response.status(statusCode).json(body);
  }

  private translateIfKey(
    body: Record<string, unknown>,
    request: Request & RequestWithLocale,
  ): Record<string, unknown> {
    const rawKey = body.message;
    if (typeof rawKey !== "string" || !I18N_KEY_PATTERN.test(rawKey)) {
      return body;
    }

    const locale = getLocale(request);
    const translated = this.i18n.translate(rawKey, { lang: locale });

    // nestjs-i18n devuelve la clave sin traducir si no hay entrada — no
    // hay traducción disponible, dejamos el body como estaba (la clave
    // cruda sigue siendo mejor que romper la respuesta).
    if (typeof translated !== "string" || translated === rawKey) {
      return body;
    }

    return { ...body, message: translated, code: rawKey };
  }
}
