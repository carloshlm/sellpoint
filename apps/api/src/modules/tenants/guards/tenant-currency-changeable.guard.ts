import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import type { AuthUser } from "../../auth/types/auth-user";
import { TenantTransactionsGate } from "../tenant-transactions.gate";

/**
 * F1-LOCALE-06: guarda el cambio de `currency` de un tenant tras el
 * onboarding. En F1 el sistema NO tiene transacciones (ventas, movimientos
 * de inventario) — `TenantTransactionsGate.hasTransactions()` siempre
 * responde `false`, así que este guard SIEMPRE permite el request hoy.
 * Queda preparado para F2-F4: cuando existan ventas/movimientos reales, el
 * ÚNICO lugar a extender es `TenantTransactionsGate` (ver TODOs ahí),
 * nunca este guard.
 *
 * Uso: `@TenantCurrencyChangeable()` en el endpoint de update de tenant
 * (dueño: F1-TENANT — todavía no existe en el repo, este guard queda listo
 * para cuando aterrice).
 */
@Injectable()
export class TenantCurrencyChangeableGuard implements CanActivate {
  constructor(private readonly transactionsGate: TenantTransactionsGate) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const body = request.body as { currency?: unknown } | undefined;

    // Sin `currency` en el body no hay cambio de moneda que guardear.
    if (!body || body.currency === undefined) {
      return true;
    }

    const tenantId = request.user?.tenantId;
    if (!tenantId) {
      // Nunca debería pasar detrás de JwtAuthGuard (secure by default), pero
      // sin tenantId no hay contra qué verificar.
      return true;
    }

    const hasTransactions = await this.transactionsGate.hasTransactions(tenantId);
    if (hasTransactions) {
      throw new ForbiddenException({ message: "tenants.currency_locked" });
    }

    return true;
  }
}
