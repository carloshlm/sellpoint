import { SetMetadata } from "@nestjs/common";

export const ALLOWED_IN_FREE_TIER_KEY = "billingAllowedInFreeTier";

/**
 * Marca un handler MUTANTE como operable sin plan de pago (F7-GUARD-02): el
 * `SubscriptionGuard` lo deja pasar aunque `write_access` esté apagado. Es
 * la lista corta de lo que el free tier SÍ hace: vender (con su límite
 * diario, que valida el POS por dentro), abrir y cerrar caja, cancelar una
 * venta y editar su propio perfil. También lo llevan los controllers de
 * billing y del backoffice: pagar y administrar planes no puede depender de
 * tener plan.
 */
export const AllowedInFreeTier = () => SetMetadata(ALLOWED_IN_FREE_TIER_KEY, true);
