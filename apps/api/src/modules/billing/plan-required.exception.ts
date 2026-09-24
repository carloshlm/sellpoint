import { HttpException, HttpStatus } from "@nestjs/common";
import type { PlanCode, PlanFeatures } from "@sellpoint/shared";

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

/**
 * F10-MANFIX-06 — el 402 de un flag del plan, escrito en UN solo lugar.
 *
 * Lo lanzan dos caminos: el `SubscriptionGuard`, cuando el flag se exige por
 * RUTA (`@RequiresFeature`), y los servicios cuyo candado depende del CUERPO
 * de la petición —encender el control por lote es una edición del producto
 * como cualquier otra, y solo esa casilla es de Plus—. Construirlo aquí
 * garantiza que los dos respondan lo mismo (la clave, el `feature` y el
 * `planCode`) y que el front abra el modal de planes igual en ambos.
 */
export function assertPlanFeature(
  entitlements: { planCode: PlanCode; features: PlanFeatures },
  feature: keyof PlanFeatures,
): void {
  if (!entitlements.features[feature]) {
    throw new PlanRequiredException("billing.feature_not_in_plan", {
      feature,
      planCode: entitlements.planCode,
    });
  }
}
