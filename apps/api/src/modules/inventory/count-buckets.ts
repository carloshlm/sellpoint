import { Prisma } from "../../generated/prisma/client";

/**
 * Una cubeta de existencias: el saldo de un lote en una ubicación de un
 * almacén. Es la fila de `stock_lots`, con el código del lote a mano porque
 * la previa trabaja con códigos (lo que trae la planilla) y el confirm con
 * ids (lo que resolvió el resolver).
 */
export interface CountBucket {
  productId: string;
  lotId: string;
  lotCode: string;
  location: string;
  quantity: Prisma.Decimal;
}

export const bucketKeyById = (lotId: string, location: string) => `${lotId}|${location}`;
export const bucketKeyByCode = (lotCode: string, location: string) => `${lotCode}|${location}`;

/**
 * TODAS las cubetas de esos productos en el almacén — no solo las que la
 * planilla menciona.
 *
 * El conteo es ABSOLUTO por producto (Carlos, 2026-09-01): INV-000009 tenía
 * los lotes sin ubicación (2, 3, 3) y la planilla los contó en A-03-02 con 60,
 * 61, 62, 63. Cada fila abrió una cubeta nueva y las viejas quedaron intactas:
 * 246 contadas y el stock decía 254. Para vaciar lo que la planilla no
 * menciona hay que conocerlo entero.
 *
 * `lock` toma `FOR UPDATE` sobre las cubetas: el confirm lo necesita para que
 * nadie las mueva entre leerlas y asentar; la previa solo mira.
 */
export async function loadCountBuckets(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  productIds: readonly string[],
  lock: boolean,
): Promise<Map<string, CountBucket[]>> {
  const porProducto = new Map<string, CountBucket[]>();
  if (productIds.length === 0) {
    return porProducto;
  }
  const filas = await tx.$queryRaw<
    { product_id: string; lot_id: string; lot_code: string; location: string; quantity: string }[]
  >`
    SELECT pl.product_id, sl.lot_id, pl.lot_code, sl.location, sl.quantity::text AS quantity
      FROM stock_lots sl
      JOIN product_lots pl ON pl.id = sl.lot_id
     WHERE sl.tenant_id = ${tenantId}::uuid
       AND sl.warehouse_id = ${warehouseId}::uuid
       AND pl.product_id = ANY(${[...productIds]}::uuid[])
     ORDER BY pl.product_id, sl.lot_id, sl.location
     ${lock ? Prisma.sql`FOR UPDATE OF sl` : Prisma.empty}`;
  for (const fila of filas) {
    const lista = porProducto.get(fila.product_id) ?? [];
    lista.push({
      productId: fila.product_id,
      lotId: fila.lot_id,
      lotCode: fila.lot_code,
      location: fila.location,
      quantity: new Prisma.Decimal(fila.quantity),
    });
    porProducto.set(fila.product_id, lista);
  }
  return porProducto;
}

/** La suma de las cubetas: lo que de verdad hay repartido en lotes. */
export function sumBuckets(buckets: readonly CountBucket[]): Prisma.Decimal {
  return buckets.reduce((total, b) => total.plus(b.quantity), new Prisma.Decimal(0));
}

/**
 * El saldo SIN lote de cada producto en el almacén: `stock_by_warehouse − Σ`
 * de TODAS sus cubetas. Ese saldo no tiene fila propia (`stock_lots.lot_id`
 * es parte de la llave): es lo que el total tiene y ningún lote cubre. Es la
 * misma cuenta que el `residuo` del conteo.
 *
 * Puede salir negativo —los lotes suman más que el producto— y se devuelve
 * tal cual: decidir qué hacer con un negativo es de quien lo usa.
 *
 * `lock` bloquea primero las filas de `stock_by_warehouse` y después las
 * cubetas, con el MISMO orden que el ledger (`ORDER BY product_id`, saldo
 * antes que lote). Así dos salidas que compiten por el mismo residuo se
 * forman: la segunda espera y relee lo que la primera ya tomó.
 */
export async function loadUnlottedRemainder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  productIds: readonly string[],
  lock: boolean,
): Promise<Map<string, Prisma.Decimal>> {
  const residuos = new Map<string, Prisma.Decimal>();
  if (productIds.length === 0) {
    return residuos;
  }
  const ids = [...new Set(productIds)].sort();
  // Con candado, la fila del saldo se CREA antes de bloquearla, igual que el
  // ledger en su paso 2. Si no existiera, el ledger la insertaría después con
  // `ON CONFLICT DO NOTHING` ya teniendo otras filas bloqueadas, y ese INSERT
  // espera a cualquier transacción que haya insertado la misma llave: un
  // bloqueo mutuo posible (lo encontró la verificación del 2026-10-31).
  if (lock) {
    await tx.$executeRaw`
      INSERT INTO stock_by_warehouse (product_id, warehouse_id, tenant_id, quantity, updated_at)
      SELECT p, ${warehouseId}::uuid, ${tenantId}::uuid, 0, now()
        FROM unnest(${ids}::uuid[]) AS p
      ON CONFLICT (product_id, warehouse_id) DO NOTHING`;
  }
  const totales = await tx.$queryRaw<{ product_id: string; quantity: string }[]>`
    SELECT product_id, quantity::text AS quantity
      FROM stock_by_warehouse
     WHERE tenant_id = ${tenantId}::uuid
       AND warehouse_id = ${warehouseId}::uuid
       AND product_id = ANY(${ids}::uuid[])
     ORDER BY product_id
     ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  const cubetas = await loadCountBuckets(tx, tenantId, warehouseId, ids, lock);

  const totalPorProducto = new Map(
    totales.map((fila) => [fila.product_id, new Prisma.Decimal(fila.quantity)]),
  );
  for (const id of ids) {
    const total = totalPorProducto.get(id) ?? new Prisma.Decimal(0);
    residuos.set(id, total.minus(sumBuckets(cubetas.get(id) ?? [])));
  }
  return residuos;
}

/**
 * Las cubetas que la planilla NO menciona y tienen saldo: son las que se
 * vacían al aprobar. Una cubeta mencionada pero OMITIDA (fila sin contado)
 * cuenta como representada y se respeta: omitir no es contar cero.
 */
export function bucketsToZero(
  buckets: readonly CountBucket[],
  represented: ReadonlySet<string>,
  keyOf: (bucket: CountBucket) => string,
): CountBucket[] {
  return buckets.filter((b) => !represented.has(keyOf(b)) && !b.quantity.isZero());
}
