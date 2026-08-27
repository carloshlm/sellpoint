import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import * as Sentry from "@sentry/node";
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

    // F6-WATCH-02: los 5xx son errores NUESTROS y van a Sentry (si hay DSN
    // configurado; sin init, captureException es un no-op silencioso). Los
    // 4xx son del cliente — reportarlos ensuciaría el proyecto con ruido.
    if (statusCode >= 500) {
      Sentry.captureException(exception);
    }
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

    // El 429 del throttler (Carlos, 2026-08-26): ThrottlerException lanza
    // "ThrottlerException: Too Many Requests" — texto del framework, no clave
    // i18n — y llegaba CRUDO a la pantalla de login. Se mapea a la clave que
    // ya existía para este caso y sigue el camino normal de traducción.
    if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      body.message = "auth.too_many_attempts";
    }

    body = this.translateIfKey(body, request);

    response.status(statusCode).json(body);
  }

  private translateIfKey(
    body: Record<string, unknown>,
    request: Request & RequestWithLocale,
  ): Record<string, unknown> {
    const locale = getLocale(request);
    // `args` viaja en el cuerpo de la excepción junto al `message`, y hay que
    // pasarlo: sin él, un mensaje con interpolación llega al usuario con el
    // placeholder crudo («La presentación «{presentationName}» solo acepta…»).
    // El bug estuvo latente desde F2 porque hasta ahora ningún mensaje general
    // interpolaba — los que sí lo hacían eran los errores POR CAMPO, que ya
    // pasaban sus `args` unas líneas más abajo.
    const translated = this.translateKey(
      body.message,
      locale,
      body.args as Record<string, unknown> | undefined,
    );

    // Los errores POR CAMPO viajan aparte del `message` de arriba y son los que
    // el formulario pinta bajo cada input. Sin esto se mostraban crudos —era el
    // `catalogs.field_required` que se veía en pantalla— aunque el mensaje
    // general saliera perfecto.
    const errors = this.translateFieldErrors(body.errors, locale);

    // `args` no sale en la respuesta: es insumo de la traducción, no dato para
    // el cliente (mismo criterio que los errores por campo).
    const { args: _discarded, ...rest } = body;
    return {
      ...rest,
      ...(translated ? { message: translated.text, code: translated.key } : {}),
      ...(errors ? { errors } : {}),
    };
  }

  /**
   * Traduce si el valor es una clave i18n Y existe la entrada. Devuelve `null`
   * cuando no hay nada que cambiar, para que el llamador deje el body intacto:
   * la clave cruda es mejor que romper la respuesta.
   */
  private translateKey(
    value: unknown,
    locale: string,
    args?: Record<string, unknown>,
  ): { text: string; key: string } | null {
    if (typeof value !== "string" || !I18N_KEY_PATTERN.test(value)) {
      return null;
    }

    // nestjs-i18n devuelve la clave misma cuando no hay entrada.
    const translated = this.i18n.translate(value, { lang: locale, args });
    if (typeof translated !== "string" || translated === value) {
      return null;
    }

    return { text: translated, key: value };
  }

  /**
   * `errors: [{ key, message }]` — el contrato de los errores por campo que
   * emiten el validador de atributos y el pipe de Zod. Cualquier otra forma
   * (por ejemplo el reporte de la importación, que trae `row`/`field`) se
   * devuelve intacta.
   */
  private translateFieldErrors(value: unknown, locale: string): unknown[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    let changed = false;
    const translated = value.map((item) => {
      if (item === null || typeof item !== "object") {
        return item;
      }
      const entry = item as Record<string, unknown>;
      const args = entry.args as Record<string, unknown> | undefined;
      const result = this.translateKey(entry.message, locale, args);
      if (!result) {
        return item;
      }
      changed = true;
      // `args` era el insumo de la traducción: ya cumplió su función y no le
      // dice nada al cliente. Se va del body para no filtrar ruido interno.
      const { args: _discarded, ...rest } = entry;
      return { ...rest, message: result.text, code: result.key };
    });

    return changed ? translated : null;
  }
}
