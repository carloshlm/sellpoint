import {
  ArgumentsHost,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { I18nService } from "nestjs-i18n";
import { AllExceptionsFilter } from "./all-exceptions.filter";

/**
 * verify #271 C2 / decisión de Carlos (`sdd/f1-auth/decisions-carlos`): el
 * filtro traduce `message` cuando tiene forma de clave i18n (`namespace.key`)
 * y expone `code` con la clave cruda. La traducción real end-to-end (con
 * `I18nService` real + `Accept-Language`) vive en
 * `test/e2e/error-i18n.e2e-spec.ts` — acá se testea la lógica del filtro
 * aislada, con un `I18nService` mockeado.
 */
describe("AllExceptionsFilter", () => {
  let filter: AllExceptionsFilter;
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));
  let translateMock: jest.Mock;
  let i18n: I18nService;

  function buildHost(request: Record<string, unknown> = { method: "GET", url: "/test" }) {
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
  }

  const host = buildHost();

  beforeEach(() => {
    jest.clearAllMocks();
    translateMock = jest.fn((key: string) => key);
    i18n = { translate: translateMock } as unknown as I18nService;
    filter = new AllExceptionsFilter(i18n);
  });

  it("formatea HttpException con mensaje string libre (no clave i18n) sin tocarlo", () => {
    filter.catch(new NotFoundException("Producto no encontrado"), host);

    expect(translateMock).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 404,
      message: "Producto no encontrado",
      error: "Not Found",
    });
  });

  it("preserva el payload objeto de una HttpException custom", () => {
    filter.catch(
      new ServiceUnavailableException({ status: "error", db: "error", redis: "ok" }),
      host,
    );

    expect(statusMock).toHaveBeenCalledWith(503);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 503,
      error: "Service Unavailable",
      status: "error",
      db: "error",
      redis: "ok",
    });
  });

  it("responde 500 genérico sin filtrar detalles internos ante errores no HTTP", () => {
    filter.catch(new Error("password=hunter2 en la línea 42"), host);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Internal server error",
      error: "Internal Server Error",
    });
  });

  it("AUTH-REQ-14: message con forma de clave i18n se traduce con el locale de la request, y agrega `code`", () => {
    translateMock.mockReturnValue("Falta el token de autenticación");
    const request = { method: "GET", url: "/me", locale: "es" };

    filter.catch(new UnauthorizedException({ message: "auth.missing_token" }), buildHost(request));

    expect(translateMock).toHaveBeenCalledWith("auth.missing_token", { lang: "es" });
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 401,
      error: "Unauthorized",
      message: "Falta el token de autenticación",
      code: "auth.missing_token",
    });
  });

  it("si nestjs-i18n no encuentra traducción (devuelve la misma clave), deja el body sin `code` ni tocar `message`", () => {
    translateMock.mockImplementation((key: string) => key); // sin entrada -> nestjs-i18n devuelve la clave
    const request = { method: "GET", url: "/me", locale: "es" };

    filter.catch(
      new UnauthorizedException({ message: "auth.some_key_without_translation" }),
      buildHost(request),
    );

    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 401,
      error: "Unauthorized",
      message: "auth.some_key_without_translation",
    });
  });
});
