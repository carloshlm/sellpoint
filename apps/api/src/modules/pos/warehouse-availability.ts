import { Prisma } from "../../generated/prisma/client";

/**
 * F4-CART-01 — cuánto hay REALMENTE para vender, en UN almacén, HOY.
 *
 * ── Por qué no alcanza con `stock_by_warehouse` ─────────────────────────
 *
 * Esa tabla responde "cuánto hay", que no es la misma pregunta que "cuánto se
 * puede vender". Tres cosas las separan:
 *
 *  1. **Los lotes vencidos cuentan en el saldo y no se venden.** Un producto
 *     con 25 unidades de las que 5 están caducadas tiene 20 vendibles. Si el
 *     buscador ofreciera las 25, el cajero las agregaría al carrito y el cobro
 *     fallaría — FEFO se niega a tomar un lote vencido para `sale` (regla de
 *     Carlos, 2026-08-20). Un buscador que ofrece lo que la caja rechaza es
 *     peor que uno que no ofrece nada.
 *
 *  2. **Un compuesto no tiene existencias propias.** Su fila en
 *     `stock_by_warehouse` está en cero para siempre, porque lo que sale del
 *     almacén son sus COMPONENTES (`expandComposition`). Filtrar por saldo > 0
 *     escondería del POS todos los combos del catálogo.
 *
 *  3. **El almacén acota.** El turno vende desde uno; lo que está en otra
 *     bodega no existe para esta venta.
 *
 * ── Por qué acá y no reusando `ComposicionService.availability` ─────────
 *
 * Aquella responde por UN producto y hace sus propias consultas. Un buscador
 * que la llamara por cada candidato sería N+1 sobre el teclado del cajero.
 * Esta es la misma cuenta, en LOTE: tres consultas fijas para N productos.
 *
 * Y es la misma fórmula a propósito — `floor(min(stock_i / qty_i × merma))`.
 * Si difirieran, la ficha del producto prometería 50 combos y el POS ofrecería
 * 47 sin que nadie pudiera explicar por qué.
 */

/** Lo vendible de un producto en el almacén del turno. */
export interface SellableStock {
  /** En unidad BASE. Lo que se puede cobrar hoy. */
  available: Prisma.Decimal;
  /**
   * Lo que hay pero está VENCIDO.
   *
   * Va aparte y no restado en silencio por el mismo motivo que `expiredSkipped`
   * en FEFO: sin este dato, "disponible 0" frente a un anaquel lleno se lee
   * como un sistema roto. Con él, el mensaje puede decir la verdad.
   */
  expired: Prisma.Decimal;
}

const CERO = new Prisma.Decimal(0);

/** Profundidad máxima del recorrido de compuestos. Mismo corte que el expander. */
const MAX_DEPTH = 20;

interface FilaLote {
  product_id: string;
  vivo: string;
  vencido: string;
}

export async function sellableStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  productIds: string[],
): Promise<Map<string, SellableStock>> {
  const resultado = new Map<string, SellableStock>();
  if (productIds.length === 0) {
    return resultado;
  }

  // ── 1. El grafo de composición del tenant, en UNA consulta ───────────────
  //
  // Se trae entero y no solo el de los candidatos: un combo pedido puede
  // llevar otro combo, y descubrir eso nivel por nivel sería N+1. Cabe en
  // memoria — mismo criterio que `expandComposition`.
  const composiciones = await tx.productComposition.findMany({
    where: { tenantId },
    select: {
      parentProductId: true,
      componentProductId: true,
      quantity: true,
      wastePercentage: true,
    },
  });
  const porPadre = new Map<string, typeof composiciones>();
  for (const fila of composiciones) {
    const actual = porPadre.get(fila.parentProductId) ?? [];
    actual.push(fila);
    porPadre.set(fila.parentProductId, actual);
  }

  // ── 2. El saldo simple de TODO lo que pueda hacer falta ──────────────────
  //
  // "Lo que pueda hacer falta" son los pedidos MÁS todo componente alcanzable
  // desde ellos: preguntar solo por los pedidos dejaría a los combos sin con
  // qué calcularse.
  const necesarios = new Set(productIds);
  for (const id of productIds) {
    recolectarComponentes(id, porPadre, necesarios, 0);
  }
  const ids = [...necesarios];

  const saldos = await tx.stockByWarehouse.findMany({
    where: { tenantId, warehouseId, productId: { in: ids } },
    select: { productId: true, quantity: true },
  });
  const saldoPorProducto = new Map(saldos.map((s) => [s.productId, s.quantity]));

  // ── 3. Los lotes, partidos en vivos y vencidos ───────────────────────────
  //
  // `>= CURRENT_DATE` y no `>`: **el día que vence, el lote todavía sirve**.
  // Mismo criterio que FEFO y que la pestaña de existencias — si difirieran,
  // el buscador ofrecería hoy lo que la caja rechazaría hoy.
  const lotes = await tx.$queryRaw<FilaLote[]>`
    SELECT pl.product_id,
           COALESCE(SUM(sl.quantity) FILTER (
             WHERE pl.expires_at IS NULL OR pl.expires_at >= CURRENT_DATE), 0)::text AS vivo,
           COALESCE(SUM(sl.quantity) FILTER (
             WHERE pl.expires_at < CURRENT_DATE), 0)::text AS vencido
      FROM stock_lots sl
      JOIN product_lots pl ON pl.id = sl.lot_id
     WHERE sl.tenant_id = ${tenantId}::uuid
       AND sl.warehouse_id = ${warehouseId}::uuid
       AND pl.product_id = ANY(${ids}::uuid[])
       AND sl.quantity > 0
     GROUP BY pl.product_id`;
  const lotePorProducto = new Map(lotes.map((l) => [l.product_id, l]));

  // ── 4. La cuenta ─────────────────────────────────────────────────────────
  //
  // `memo` no es solo velocidad: sin él, un combo que aparece dos veces en el
  // árbol se recalcularía, y el corte por profundidad daría números distintos
  // según por dónde se llegó.
  const memo = new Map<string, Prisma.Decimal>();
  const visitando = new Set<string>();

  /** Lo vendible de un producto, sin mirar si es compuesto o no. */
  const disponible = (productId: string, depth: number): Prisma.Decimal => {
    const cacheado = memo.get(productId);
    if (cacheado !== undefined) {
      return cacheado;
    }
    // Ciclo o árbol demasiado hondo: devolver 0 es lo prudente. F2-BOM-01
    // impide crear ciclos, pero un dato heredado no puede colgar el buscador.
    if (visitando.has(productId) || depth > MAX_DEPTH) {
      return CERO;
    }

    const receta = porPadre.get(productId);
    if (receta === undefined || receta.length === 0) {
      return propio(productId);
    }

    visitando.add(productId);
    let techo: Prisma.Decimal | null = null;
    for (const linea of receta) {
      // La MISMA fórmula que `expandComposition` y que F2-BOM-02: la merma es
      // parte de lo que hace falta, no un descuento aparte.
      const necesita = linea.quantity.times(
        new Prisma.Decimal(1).plus(linea.wastePercentage.dividedBy(100)),
      );
      if (necesita.lessThanOrEqualTo(0)) {
        continue;
      }
      const arma = disponible(linea.componentProductId, depth + 1)
        .dividedBy(necesita)
        .floor();
      techo = techo === null ? arma : Prisma.Decimal.min(techo, arma);
    }
    visitando.delete(productId);

    const total = techo === null ? CERO : Prisma.Decimal.max(CERO, techo);
    memo.set(productId, total);
    return total;
  };

  /** El saldo PROPIO: por lotes si los lleva, por `stock_by_warehouse` si no. */
  const propio = (productId: string): Prisma.Decimal => {
    const lote = lotePorProducto.get(productId);
    if (lote !== undefined) {
      return new Prisma.Decimal(lote.vivo);
    }
    return saldoPorProducto.get(productId) ?? CERO;
  };

  for (const productId of productIds) {
    resultado.set(productId, {
      available: disponible(productId, 0),
      expired: new Prisma.Decimal(lotePorProducto.get(productId)?.vencido ?? 0),
    });
  }
  return resultado;
}

/** Todo lo alcanzable desde `productId` bajando por la receta. */
function recolectarComponentes(
  productId: string,
  porPadre: Map<string, { componentProductId: string }[]>,
  destino: Set<string>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  for (const linea of porPadre.get(productId) ?? []) {
    if (destino.has(linea.componentProductId)) {
      continue;
    }
    destino.add(linea.componentProductId);
    recolectarComponentes(linea.componentProductId, porPadre, destino, depth + 1);
  }
}
