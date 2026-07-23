import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";

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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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

    response.status(statusCode).json(body);
  }
}
