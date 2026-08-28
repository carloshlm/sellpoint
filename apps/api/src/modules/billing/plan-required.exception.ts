import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * F7-GUARD-01 — el 402 Payment Required del sistema de planes.
 *
 * Nest no trae esta excepción y el status importa: el 403 queda reservado
 * para permisos (`auth.forbidden` — tu ROL no puede) y el 402 para el plan
 * (tu PLAN no incluye). El interceptor del front abre el modal de planes con
 * cualquier 402, usando `message` (clave i18n de `billing.json`) y `args`
 * para el detalle ("te quedan 0 de 10 ventas"). El `AllExceptionsFilter` la
 * traduce sin tocarlo: es una HttpException con forma `namespace.key`.
 */
export class PlanRequiredException extends HttpException {
  constructor(message: string, args?: Record<string, unknown>) {
    super(args === undefined ? { message } : { message, args }, HttpStatus.PAYMENT_REQUIRED);
  }
}
