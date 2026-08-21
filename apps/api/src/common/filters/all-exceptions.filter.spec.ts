import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
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

  it("traduce también los errores POR CAMPO, que son los que el formulario pinta", () => {
    // El caso que Carlos fotografió: el `message` de arriba se traducía, pero
    // `errors[].message` viajaba crudo y el front lo pintaba tal cual bajo el
    // input — `catalogs.field_required` en la cara del usuario.
    translateMock.mockImplementation((key: string) =>
      key === "catalogs.field_required" ? "Este campo es obligatorio." : key,
    );
    const request = { method: "POST", url: "/products", locale: "es" };

    filter.catch(
      new BadRequestException({
        message: "products.invalid_attributes",
        errors: [{ key: "proveedor", message: "catalogs.field_required" }],
      }),
      buildHost(request),
    );

    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 400,
      error: "Bad Request",
      // Sin traducción disponible, esta queda cruda: es el comportamiento ya
      // establecido y no lo cambia esta mejora.
      message: "products.invalid_attributes",
      errors: [
        {
          key: "proveedor",
          message: "Este campo es obligatorio.",
          // La clave cruda sobrevive para que el front discrimine sin parsear
          // texto, igual que el `code` de nivel superior.
          code: "catalogs.field_required",
        },
      ],
    });
  });

  it("un error por campo sin traducción conserva su clave y no inventa `code`", () => {
    translateMock.mockImplementation((key: string) => key);
    const request = { method: "POST", url: "/products", locale: "es" };

    filter.catch(
      new BadRequestException({
        message: "products.invalid_attributes",
        errors: [{ key: "proveedor", message: "catalogs.sin_traduccion" }],
      }),
      buildHost(request),
    );

    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 400,
      error: "Bad Request",
      message: "products.invalid_attributes",
      errors: [{ key: "proveedor", message: "catalogs.sin_traduccion" }],
    });
  });

  it("no toca `errors` cuando no es la lista de errores por campo", () => {
    // El reporte de importación viaja en `errors` con OTRA forma (row/field) y
    // sus mensajes ya se traducen en el front fila por fila.
    translateMock.mockImplementation((key: string) => key);

    filter.catch(
      new BadRequestException({ message: "products.import_has_errors", errors: "no soy un array" }),
      buildHost({ method: "POST", url: "/products/import", locale: "es" }),
    );

    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 400,
      error: "Bad Request",
      message: "products.import_has_errors",
      errors: "no soy un array",
    });
  });

  /**
   * F4-UI-02 — el CONTRATO del que depende el carrito del POS.
   *
   * El filtro descarta `args` porque es insumo de la traducción, no dato para
   * el cliente. Pero todo lo DEMÁS que traiga la excepción viaja intacto, y eso
   * es lo que deja al ledger mandar el `sku` del renglón culpable para que el
   * carrito lo pinte encima.
   *
   * Este test existe porque hasta ahora ese pasaje era un ACCIDENTE del
   * `{ args, ...rest }`, sin nada que lo fijara: el día que alguien cambie el
   * filtro por una lista blanca de claves, el POS dejaría de señalar la línea
   * y nadie se enteraría hasta verlo en un mostrador.
   */
  it("descarta `args` pero deja pasar los demás datos de la excepción", () => {
    translateMock.mockImplementation((key: string) => key);

    filter.catch(
      new UnprocessableEntityException({
        message: "inventory.insufficient_stock",
        args: { sku: "AGUA", available: "1", requested: "2" },
        sku: "AGUA",
      }),
      buildHost({ method: "POST", url: "/pos/sales", locale: "es" }),
    );

    const body = jsonMock.mock.calls[0]?.[0] as Record<string, unknown>;
    // El dato sobrevive…
    expect(body.sku).toBe("AGUA");
    // …y `args` no, que es lo que lo distingue de él.
    expect(body).not.toHaveProperty("args");
  });
});
