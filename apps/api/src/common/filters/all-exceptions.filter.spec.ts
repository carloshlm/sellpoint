import { ArgumentsHost, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

describe("AllExceptionsFilter", () => {
  let filter: AllExceptionsFilter;
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusMock }),
      getRequest: () => ({ method: "GET", url: "/test" }),
    }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new AllExceptionsFilter();
  });

  it("formatea HttpException con mensaje string", () => {
    filter.catch(new NotFoundException("Producto no encontrado"), host);

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
});
