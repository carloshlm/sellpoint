import { SetMetadata } from "@nestjs/common";
import type { PlanFeatures } from "@sellpoint/shared";

export const REQUIRES_FEATURE_KEY = "billingRequiresFeature";

/**
 * Declara qué flag de la matriz del plan exige un handler (F7-GUARD-02). Lo
 * lee el `SubscriptionGuard`, que solo lo aplica a métodos MUTANTES: leer la
 * historia propia nunca se bloquea (un ex-Pro degradado sigue viendo su
 * kardex), crear lo que el plan no incluye responde 402.
 *
 *   @RequiresFeature("lots")
 *   @Patch(":id/lots/:lotId")
 *   updateLot() { ... }
 */
export const RequiresFeature = (feature: keyof PlanFeatures) =>
  SetMetadata(REQUIRES_FEATURE_KEY, feature);
