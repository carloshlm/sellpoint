import { SetMetadata } from "@nestjs/common";
import type { ModuleKey } from "@sellpoint/shared";

export const REQUIRES_MODULE_KEY = "billingRequiresModule";

/**
 * F9-MOD-06 — declara qué módulo avanzado exige un handler (o un controller
 * entero). Lo lee el `SubscriptionGuard`, que a diferencia de
 * `@RequiresFeature` lo aplica TAMBIÉN a las lecturas: un módulo vertical
 * nunca estuvo en un plan público, así que no hay historia «ya pagada» que
 * respetar — apagado, se apaga entero. Los datos no se borran; reactivar los
 * devuelve. Responde 402 `billing.module_not_enabled`.
 *
 *   @RequiresModule("reception")
 *   @Controller("reception/customers")
 *   export class ReceptionCustomersController { ... }
 */
export const RequiresModule = (moduleKey: ModuleKey) => SetMetadata(REQUIRES_MODULE_KEY, moduleKey);
