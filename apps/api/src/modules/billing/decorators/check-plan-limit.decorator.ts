import { SetMetadata } from "@nestjs/common";

export const CHECK_PLAN_LIMIT_KEY = "billingCheckPlanLimit";

export type PlanLimitDimension = "users" | "warehouses";

/**
 * Declara que el handler CREA un recurso limitado por plan (F7-GUARD-02).
 * El `SubscriptionGuard` cuenta lo existente contra el `max_*` del plan y
 * responde 402 al llegar al tope — SOLO al crear: un downgrade jamás
 * suspende usuarios ni borra almacenes (invariante de la fase).
 *
 *   @CheckPlanLimit("users")
 *   @Post()
 *   create() { ... }
 */
export const CheckPlanLimit = (dimension: PlanLimitDimension) =>
  SetMetadata(CHECK_PLAN_LIMIT_KEY, dimension);
