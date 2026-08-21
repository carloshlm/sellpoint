import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { MovementDirection, MovementReason } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import type { ExpandedLine } from "./composition-expander";

export interface LedgerHeader {
  /**
   * De qué operación cuelgan los movimientos. **Exactamente una** de las dos:
   * un documento de inventario (`ENT`/`SAL`/`INV`) o una VENTA — la base lo
   * garantiza con un CHECK, así que mandar las dos o ninguna revienta ahí y no
   * en un `if` que alguien pueda olvidar.
   */
  documentId?: string | null;
  /** La venta que originó estos movimientos (F4-SALE-01). */
  saleId?: string | null;
  reasonNote?: string | null;
  reference?: string | null;
  authorizedBy?: string | null;
  linkedWarehouseId?: string | null;
}

export interface LedgerInput {
  tenantId: string;
  userId: string;
  direction: MovementDirection;
  reasonCode: MovementReason;
  warehouseId: string;
  lines: ExpandedLine[];
  header: LedgerHeader;
}

export interface LedgerResult {
  documentId: string | null;
  saleId?: string | null;
  /**
   * `direction` viaja en cada movimiento porque un CONTEO devuelve las dos en
   * la misma respuesta (salida del teórico + entrada de lo contado): sin ella,
   * quien la lee no puede distinguirlas.
   */
  movements: {
    productId: string;
    direction: MovementDirection;
    quantityBase: string;
    lotId: string | null;
  }[];
  stock: { productId: string; warehouseId: string; quantity: string }[];
  lots: { lotId: string; warehouseId: string; location: string; quantity: string }[];
}

/** Clave de agrupación de saldos por producto y almacén. */
const stockKey = (productId: string, warehouseId: string) => `${productId}|${warehouseId}`;
/** Clave de agrupación de saldos por lote, almacén y ubicación. */
const lotKey = (lotId: string, warehouseId: string, location: string) =>
  `${lotId}|${warehouseId}|${location}`;

/**
 * F3-CORE-05 — la ÚNICA puerta por la que se mueve el stock.
 *
 * Entradas, salidas, recepción de traspaso, aprobación de conteo y —en F4— la
 * venta son **llamadores** de este servicio, nunca escritores propios. Tener
 * una sola implementación de "mover stock" es lo que hace que la propiedad
 * central de la fase sea demostrable: el saldo es siempre Σentradas − Σsalidas.
 *
 * ── El orden de los pasos, y por qué ese ────────────────────────────────
 *
 *  1. **Agrupar** por (producto, almacén) sumando. Dos líneas del mismo
 *     producto tienen que validarse JUNTAS: pedir 6 y 5 con 10 disponibles
 *     debe fallar, y validando línea por línea las dos pasarían.
 *  2. **Crear las filas faltantes** con `ON CONFLICT DO NOTHING`. No se puede
 *     bloquear una fila que no existe, y el primer movimiento de un producto
 *     es justamente el caso donde no existe.
 *  3. **`SELECT … FOR UPDATE` ORDENADO** por (product_id, warehouse_id). El
 *     orden no es estético: dos transacciones que tomaran A→B y B→A se
 *     bloquearían mutuamente para siempre. Pidiendo siempre en el mismo orden,
 *     una espera a la otra y las dos terminan.
 *  4. **Validar** contra lo que se acaba de leer BLOQUEADO, no contra una
 *     lectura previa. Ahí está la diferencia entre no vender de más y creer
 *     que no se vende de más.
 *  5. **Asentar** los movimientos: uno por línea ORIGINAL, no por grupo — el
 *     kardex tiene que mostrar lo que la persona capturó.
 *  6. **Actualizar** los saldos con `quantity ± Δ`, no con un valor calculado
 *     en JavaScript: la suma la hace Postgres sobre la fila bloqueada.
 *
 * `apply` **nunca abre transacción**: recibe la `tx` del llamador, igual que
 * `AuditService.record`. Quien decide el alcance es quien sabe qué más tiene
 * que ser atómico junto con esto.
 */
@Injectable()
export class StockLedgerService {
  async apply(tx: Prisma.TransactionClient, input: LedgerInput): Promise<LedgerResult> {
    const { tenantId, warehouseId, direction, lines } = input;
    const signo = direction === "entry" ? 1 : -1;

    // ── 1. Agrupar ────────────────────────────────────────────────────────
    const porStock = new Map<string, { productId: string; delta: Prisma.Decimal; sku: string }>();
    const porLote = new Map<
      string,
      { lotId: string; location: string; delta: Prisma.Decimal; sku: string }
    >();

    for (const line of lines) {
      const key = stockKey(line.productId, warehouseId);
      const actual = porStock.get(key);
      porStock.set(key, {
        productId: line.productId,
        sku: line.sku,
        delta: (actual?.delta ?? new Prisma.Decimal(0)).plus(line.quantityBase),
      });

      if (line.lotId !== undefined) {
        const location = line.location ?? "";
        const lk = lotKey(line.lotId, warehouseId, location);
        const previo = porLote.get(lk);
        porLote.set(lk, {
          lotId: line.lotId,
          location,
          sku: line.sku,
          delta: (previo?.delta ?? new Prisma.Decimal(0)).plus(line.quantityBase),
        });
      }
    }

    // ── 2. Crear las filas que faltan ─────────────────────────────────────
    // `DO NOTHING` y no `DO UPDATE`: acá solo se garantiza que la fila exista
    // para poder bloquearla; el saldo lo mueve el paso 6.
    const productIds = [...porStock.values()].map((g) => g.productId);
    await tx.$executeRaw`
      INSERT INTO stock_by_warehouse (product_id, warehouse_id, tenant_id, quantity, updated_at)
      SELECT p, ${warehouseId}::uuid, ${tenantId}::uuid, 0, now()
        FROM unnest(${productIds}::uuid[]) AS p
      ON CONFLICT (product_id, warehouse_id) DO NOTHING`;

    for (const grupo of porLote.values()) {
      await tx.$executeRaw`
        INSERT INTO stock_lots (lot_id, warehouse_id, location, tenant_id, quantity, updated_at)
        VALUES (${grupo.lotId}::uuid, ${warehouseId}::uuid, ${grupo.location}, ${tenantId}::uuid, 0, now())
        ON CONFLICT (lot_id, warehouse_id, location) DO NOTHING`;
    }

    // ── 3. Bloquear, SIEMPRE en el mismo orden ────────────────────────────
    const saldos = await tx.$queryRaw<{ product_id: string; quantity: string }[]>`
      SELECT product_id, quantity::text AS quantity
        FROM stock_by_warehouse
       WHERE tenant_id = ${tenantId}::uuid
         AND warehouse_id = ${warehouseId}::uuid
         AND product_id = ANY(${productIds}::uuid[])
       ORDER BY product_id
         FOR UPDATE`;
    const saldoPorProducto = new Map(
      saldos.map((r) => [r.product_id, new Prisma.Decimal(r.quantity)]),
    );

    const lotIds = [...porLote.values()].map((g) => g.lotId);
    const saldosLote =
      lotIds.length === 0
        ? []
        : await tx.$queryRaw<{ lot_id: string; location: string; quantity: string }[]>`
            SELECT lot_id, location, quantity::text AS quantity
              FROM stock_lots
             WHERE tenant_id = ${tenantId}::uuid
               AND warehouse_id = ${warehouseId}::uuid
               AND lot_id = ANY(${lotIds}::uuid[])
             ORDER BY lot_id, location
               FOR UPDATE`;
    const saldoPorLote = new Map(
      saldosLote.map((r) => [
        lotKey(r.lot_id, warehouseId, r.location),
        new Prisma.Decimal(r.quantity),
      ]),
    );

    // ── 4. Validar contra lo que se acaba de leer BLOQUEADO ───────────────
    if (direction === "exit") {
      for (const grupo of porStock.values()) {
        const disponible = saldoPorProducto.get(grupo.productId) ?? new Prisma.Decimal(0);
        if (disponible.lessThan(grupo.delta)) {
          throw new UnprocessableEntityException({
            message: "inventory.insufficient_stock",
            args: {
              productId: grupo.productId,
              sku: grupo.sku,
              available: disponible.toString(),
              requested: grupo.delta.toString(),
            },
            // ── Fuera de `args` A PROPÓSITO (F4-UI-02) ───────────────────
            //
            // El filtro CONSUME `args` para traducir y después lo descarta: es
            // insumo del texto, no dato para el cliente. Pero el carrito del
            // POS necesita saber de QUÉ renglón habla el rechazo para pintarlo
            // encima — y eso no es texto, es RUTEO.
            //
            // La alternativa era que el front sacara el SKU parseando el
            // mensaje ya traducido. Eso se rompe al cambiar de idioma y al
            // retocar una coma del copy: un dato tiene que viajar como dato.
            sku: grupo.sku,
          });
        }
      }

      for (const [key, grupo] of porLote) {
        const disponible = saldoPorLote.get(key) ?? new Prisma.Decimal(0);
        if (disponible.lessThan(grupo.delta)) {
          throw new UnprocessableEntityException({
            message: "inventory.insufficient_lot_stock",
            args: {
              lotCode: grupo.lotId,
              available: disponible.toString(),
              requested: grupo.delta.toString(),
            },
            // Mismo criterio que arriba. Lo que ubica el renglón del carrito es
            // el SKU y no el lote: el reparto FEFO lo eligió el servidor, así
            // que el cajero nunca vio ese código.
            sku: grupo.sku,
          });
        }
      }
    }

    // ── 5. Asentar: uno por línea ORIGINAL ────────────────────────────────
    await tx.stockMovement.createMany({
      data: lines.map((line) => ({
        tenantId,
        documentId: input.header.documentId ?? null,
        saleId: input.header.saleId ?? null,
        productId: line.productId,
        warehouseId,
        presentationId: line.presentationId,
        parentProductId: line.parentProductId ?? null,
        direction,
        reasonCode: input.reasonCode,
        reasonNote: input.header.reasonNote ?? null,
        reference: input.header.reference ?? null,
        authorizedBy: input.header.authorizedBy ?? null,
        linkedWarehouseId: input.header.linkedWarehouseId ?? null,
        lotId: line.lotId ?? null,
        location: line.lotId === undefined ? null : (line.location ?? ""),
        quantity: line.quantityBase,
        unitCost: line.unitCost,
        createdBy: input.userId,
      })),
    });

    // ── 6. Mover los saldos ───────────────────────────────────────────────
    const stock: LedgerResult["stock"] = [];
    for (const grupo of porStock.values()) {
      const delta = grupo.delta.mul(signo);
      const [row] = await tx.$queryRaw<{ quantity: string }[]>`
        UPDATE stock_by_warehouse
           SET quantity = quantity + ${delta.toString()}::numeric, updated_at = now()
         WHERE tenant_id = ${tenantId}::uuid
           AND warehouse_id = ${warehouseId}::uuid
           AND product_id = ${grupo.productId}::uuid
        RETURNING quantity::text AS quantity`;
      stock.push({
        productId: grupo.productId,
        warehouseId,
        quantity: row?.quantity ?? "0",
      });
    }

    // ── 7. Y los saldos por lote, para que Σ lotes == total ───────────────
    const lots: LedgerResult["lots"] = [];
    for (const grupo of porLote.values()) {
      const delta = grupo.delta.mul(signo);
      const [row] = await tx.$queryRaw<{ quantity: string }[]>`
        UPDATE stock_lots
           SET quantity = quantity + ${delta.toString()}::numeric, updated_at = now()
         WHERE tenant_id = ${tenantId}::uuid
           AND warehouse_id = ${warehouseId}::uuid
           AND lot_id = ${grupo.lotId}::uuid
           AND location = ${grupo.location}
        RETURNING quantity::text AS quantity`;
      lots.push({
        lotId: grupo.lotId,
        warehouseId,
        location: grupo.location,
        quantity: row?.quantity ?? "0",
      });
    }

    return {
      documentId: input.header.documentId ?? null,
      saleId: input.header.saleId ?? null,
      movements: lines.map((l) => ({
        productId: l.productId,
        direction,
        quantityBase: l.quantityBase.toString(),
        lotId: l.lotId ?? null,
      })),
      stock,
      lots,
    };
  }
}
