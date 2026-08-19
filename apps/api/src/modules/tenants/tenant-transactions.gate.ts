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
 * TODO(F4): sumar `tx.sale.count(...)` cuando aterricen las ventas del POS.
 *
 * Extender ACÁ, nunca en `TenantCurrencyChangeableGuard` — el guard no debe
 * conocer el detalle de qué cuenta como "transacción".
 */
@Injectable()
export class TenantTransactionsGate {
  constructor(private readonly prisma: PrismaService) {}

  async hasTransactions(tenantId: string): Promise<boolean> {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const movimientos = await tx.stockMovement.count();
      return movimientos > 0;
    });
  }
}
