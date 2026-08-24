import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * F5-COST-01 — el costo promedio ponderado de las COMPRAS.
 *
 * Herencia de F3 (decisión de Carlos, diferida el 2026-08-17): la fase 3
 * registró `unit_cost` en cada entrada por factura y dejó el cálculo para acá.
 *
 * ── Qué cuenta como compra ──────────────────────────────────────────────
 *
 * ENTRADAS con `reason_code = 'invoice'` y costo capturado. Nada más. Un
 * ajuste que sube stock no dice cuánto costó la mercancía; una devolución de
 * cliente devuelve algo que ya se había comprado; un traspaso mueve lo que ya
 * era nuestro. Dejarlos entrar —aunque fuera con costo cero— derrumbaría el
 * promedio sin que nadie pudiera explicar por qué.
 *
 * **No hace falta filtrar por `direction`**, y la consulta no lo hace. El
 * CHECK `stock_movements_direction_reason_check` (migración
 * `20260818013308_f3_stock_movements`) lista `invoice` SOLO del lado de las
 * entradas: la fila «salida por factura» no se puede construir. Una
 * contraprueba lo demostró — agregar `AND m.direction = 'entry'` no ponía rojo
 * ningún test, porque el caso del que protegería es imposible.
 *
 * Que esa garantía siga en pie lo vigila el test «la base IMPIDE una salida
 * por factura»: si alguien relajara el CHECK para permitir devoluciones al
 * proveedor, ese test se pone rojo ANTES de que esas salidas empiecen a
 * contarse acá como compras.
 *
 * ── Por qué hay que dividir por el `factor` ─────────────────────────────
 *
 * El asiento guarda las dos cosas en unidades DISTINTAS: `quantity` va en la
 * `base_unit` del producto (24 piezas) y `unit_cost` al nivel de la
 * presentación que la persona capturó ($120 la caja). Sin dividir por el
 * factor de esa presentación, una caja de 12 costaría lo mismo que una pieza.
 * `presentation_id` nulo significa que se capturó en la unidad base: ahí el
 * factor es 1 y el costo se toma tal cual.
 *
 * ── Por qué GLOBAL y no por almacén ─────────────────────────────────────
 *
 * Decisión de Carlos (2026-08-21): un traspaso no cambia lo que costó la
 * mercancía. Si algún día cada sucursal compra a precios muy distintos, se
 * migra a por-almacén — y ese día el cambio vive solo acá.
 *
 * ── Por qué `null` y no `0` ─────────────────────────────────────────────
 *
 * «No sé cuánto costó» y «costó cero» son afirmaciones distintas, y un cero
 * fingido se SUMA al valor del inventario y lo hace mentir. El consumidor
 * decide su fallback: el reporte de stock deja la celda vacía, el BOM cae al
 * `cost/factor` de la presentación.
 */
@Injectable()
export class WeightedCostService {
  constructor(private readonly prisma: PrismaService) {}

  /** El promedio de UN producto, o `null` si nunca se compró con costo. */
  async averageCost(tenantId: string, productId: string): Promise<Prisma.Decimal | null> {
    const costos = await this.averageCosts(tenantId, [productId]);
    return costos.get(productId) ?? null;
  }

  /**
   * El promedio de VARIOS productos en una sola consulta.
   *
   * El reporte de stock valoriza cientos de filas: preguntar de a uno sería
   * un N+1 contra el libro mayor entero. Los productos sin historial quedan
   * AUSENTES del mapa —no en cero—, para que quien lo lea siga pudiendo
   * distinguir «no sé» de «vale nada».
   */
  async averageCosts(
    tenantId: string,
    productIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (productIds.length === 0) {
      return new Map();
    }

    // La suma la hace Postgres en `numeric`: acumular en JavaScript traería
    // el error de coma flotante justo al número que después se multiplica por
    // el stock entero para valorizar el inventario.
    //
    // `COALESCE(factor, 1)`: el LEFT JOIN no encuentra presentación cuando el
    // movimiento se capturó en la unidad base, y ahí el costo ya está en base.
    const filas = await this.prisma.withTenantContext(
      tenantId,
      (tx) =>
        tx.$queryRaw<{ product_id: string; average: string }[]>`
        SELECT m.product_id,
               (SUM(m.quantity * (m.unit_cost / COALESCE(p.factor, 1)))
                  / SUM(m.quantity))::text AS average
          FROM stock_movements m
          LEFT JOIN product_presentations p ON p.id = m.presentation_id
         WHERE m.tenant_id = ${tenantId}::uuid
           AND m.product_id = ANY(${[...productIds]}::uuid[])
           -- Sin filtro de direction A PROPÓSITO: ver la nota del docblock.
           AND m.reason_code = 'invoice'
           AND m.unit_cost IS NOT NULL
           -- Una compra de cantidad cero no aporta peso y volvería indefinida
           -- la división. No debería existir, pero el promedio no es el lugar
           -- para descubrirlo.
           AND m.quantity > 0
         GROUP BY m.product_id`,
    );

    return new Map(filas.map((fila) => [fila.product_id, new Prisma.Decimal(fila.average)]));
  }
}
