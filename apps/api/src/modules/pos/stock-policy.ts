import type { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { EntitlementsService } from "../billing/entitlements.service";

/**
 * ¿Este negocio vende aunque el inventario marque cero?
 *
 * La regla efectiva (decisión de Carlos, 2026-08-27): vende sin validar stock
 * quien NO tiene control de inventario en su plan O quien prendió «Vender sin
 * existencias» en los ajustes del negocio.
 *
 * ── Por qué es UNA función y no tres copias ─────────────────────────────
 *
 * La regla la consultan tres momentos distintos del mostrador: el BUSCADOR
 * (¿ofrezco el producto?), la carga de una COTIZACIÓN (¿marco la línea como
 * no disponible?) y el COBRO (¿acepto la venta?). El bug del 2026-09-01 fue
 * exactamente que solo el cobro la aplicaba: el toggle decía que sí y el
 * buscador escondía el producto igual. Tres copias de la misma regla son tres
 * lugares donde volver a divergir; una función es la garantía de que el
 * buscador, la cotización y la caja contestan lo mismo.
 *
 * Son dos lecturas baratas (plan cacheado en Redis + un campo del tenant) y
 * se hacen FUERA de la transacción del llamador.
 */
export async function allowNegativeStock(
  entitlements: EntitlementsService,
  prisma: PrismaService,
  tenantId: string,
): Promise<boolean> {
  const plan = await entitlements.resolve(tenantId);
  const negocio = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { sellWithoutStock: true },
  });
  return !plan.stockControl || negocio?.sellWithoutStock === true;
}
