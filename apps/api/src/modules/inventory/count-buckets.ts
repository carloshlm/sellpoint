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
