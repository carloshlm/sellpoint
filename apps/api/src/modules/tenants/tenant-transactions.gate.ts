import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * F1-LOCALE-06: puerto que responde si un tenant ya tiene transacciones
 * operativas (ventas, movimientos de inventario, etc.) — el criterio real
 * para bloquear el cambio de `currency` post-onboarding.
 *
 * F3-GUARDS-04: ya cuenta `stock_movements`. Un solo movimiento asentado
 * congela la moneda, y la razón es que **los importes ya escritos no tienen
 * unidad propia**: la heredan del tenant. Cambiarla reinterpretaría toda la
 * historia sin tocar un número.
 * F4-SALE-01 suma las VENTAS. Una venta de servicio puro no escribe un solo
 * `stock_movement` —un servicio no tiene existencias—, así que contar solo el
 * ledger habría dejado a un negocio de puros servicios cambiando su moneda con
 * el cajón lleno de tickets ya cobrados en la moneda vieja.
 *
 * Extender ACÁ, nunca en `TenantCurrencyChangeableGuard` — el guard no debe
 * conocer el detalle de qué cuenta como "transacción".
 */
@Injectable()
export class TenantTransactionsGate {
  constructor(private readonly prisma: PrismaService) {}

  async hasTransactions(tenantId: string): Promise<boolean> {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      // Dos cuentas y no una: hay ventas que no dejan rastro en el ledger.
      const [movimientos, ventas] = await Promise.all([tx.stockMovement.count(), tx.sale.count()]);
      return movimientos > 0 || ventas > 0;
    });
  }
}
