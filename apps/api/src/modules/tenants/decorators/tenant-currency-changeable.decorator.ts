import { UseGuards } from "@nestjs/common";
import { TenantCurrencyChangeableGuard } from "../guards/tenant-currency-changeable.guard";

/**
 * F1-LOCALE-06: aplicar en el/los endpoint(s) que puedan actualizar
 * `tenant.currency` (ej. el futuro `PATCH /tenants/:id` de F1-TENANT).
 * Ver TenantCurrencyChangeableGuard para el comportamiento.
 */
export const TenantCurrencyChangeable = () => UseGuards(TenantCurrencyChangeableGuard);
