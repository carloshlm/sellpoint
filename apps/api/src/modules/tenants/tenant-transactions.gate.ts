import { Injectable } from "@nestjs/common";

/**
 * F1-LOCALE-06: puerto que responde si un tenant ya tiene transacciones
 * operativas (ventas, movimientos de inventario, etc.) — el criterio real
 * para bloquear el cambio de `currency` post-onboarding.
 *
 * F1: NO existen esas tablas todavía → SIEMPRE `false` (nunca bloquea).
 * TODO(F2): sumar `tx.sale.count({ where: { tenantId } }) > 0` cuando
 * aterricen las ventas.
 * TODO(F3-F4): sumar movimientos de inventario / otras fuentes de
 * transacciones que definan "el tenant ya operó".
 *
 * Extender ACÁ, nunca en `TenantCurrencyChangeableGuard` — el guard no debe
 * conocer el detalle de qué cuenta como "transacción".
 */
@Injectable()
export class TenantTransactionsGate {
  async hasTransactions(_tenantId: string): Promise<boolean> {
    return false;
  }
}
