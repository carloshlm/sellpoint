import { Injectable, NotFoundException } from "@nestjs/common";
import type { MovementDirection, MovementReason } from "@sellpoint/shared";
import { endOfDayUtc, startOfDayUtc } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { CompositionService } from "../products/composition.service";
import { assertWarehouseInScope } from "./warehouse-scope.helpers";

export interface KardexOptions {
  warehouseId?: string;
  /** Día del calendario del negocio (`YYYY-MM-DD`), no un instante. */
  from?: string;
  to?: string;
  direction?: MovementDirection;
  reasonCode?: MovementReason;
  lotId?: string;
  page?: number;
  pageSize?: number;
}

/** Lo que devuelve la CTE. Todo texto: los DECIMAL y BigInt no viajan crudos. */
interface KardexRawRow {
  id: string;
  created_at: Date;
  direction: MovementDirection;
  reason_code: MovementReason;
  reason_note: string | null;
  reference: string | null;
  quantity: string;
  unit_cost: string | null;
  location: string | null;
  balance_after: string;
  document_id: string;
  folio: string;
  document_type: string;
  document_status: string;
  warehouse_id: string;
  warehouse_name: string;
  linked_warehouse_id: string | null;
  linked_warehouse_name: string | null;
  presentation_id: string | null;
  presentation_name: string | null;
  presentation_factor: string | null;
  lot_id: string | null;
  lot_code: string | null;
  lot_expires_at: Date | null;
  parent_product_id: string | null;
  parent_sku: string | null;
  parent_name: string | null;
  created_by: string;
  created_by_name: string;
  total: bigint;
}

/**
 * F3-KARDEX-01 — el kardex de un producto.
 *
 * **`balanceAfter` es lo que justifica que este endpoint exista.** Un listado
 * de movimientos lo da cualquier `findMany`; lo que nadie puede reconstruir
 * mirando una página es el saldo que QUEDÓ después de cada línea.
 *
 * Por eso hay `$queryRaw` y no Prisma: la window function corre sobre TODO el
 * histórico del producto en los almacenes del alcance, y los filtros y la
 * paginación se aplican DESPUÉS. Calcularla sobre la página haría que la
 * primera fila arrancara en cero; calcularla sobre lo filtrado inventaría un
 * saldo que nunca existió (esconder las salidas no las deshace).
 *
 * `PARTITION BY warehouse_id` porque el saldo es de un almacén, no del
 * producto: mezclar dos bodegas daría un número que no está en ningún lado.
 *
 * `ORDER BY created_at, seq` porque las N líneas de una misma factura
 * comparten `created_at` al microsegundo —`transaction_timestamp()`— y sin el
 * desempate los saldos intermedios saldrían en cualquier orden. `seq` es la
 * columna IDENTITY que la base asigna y nadie elige.
 */
@Injectable()
export class KardexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly composition: CompositionService,
  ) {}

  async list(user: AuthUser, scope: UserScope, productId: string, options: KardexOptions = {}) {
    if (options.warehouseId !== undefined) {
      assertWarehouseInScope(scope, options.warehouseId);
    }

    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId: user.tenantId },
        select: { id: true, isComposite: true },
      });

      // ── El rango son DÍAS del calendario del negocio ──────────────────
      // `from`/`to` llegan como `YYYY-MM-DD`. Mandarlos crudos a Postgres los
      // volvía `00:00:00+00` y el día en curso quedaba fuera (Carlos,
      // 2026-08-24). `desde` es inclusivo y `hasta` ABIERTO —el arranque del
      // día siguiente— para no perder el último milisegundo.
      const zona = await zonaDelNegocio(tx, user.tenantId);
      const desde = options.from !== undefined ? startOfDayUtc(options.from, zona) : null;
      const hasta = options.to !== undefined ? endOfDayUtc(options.to, zona) : null;
      if (product === null) {
        throw new NotFoundException({ message: "products.not_found" });
      }

      // El alcance acota QUÉ almacenes entran al histórico. `null` = todos.
      const alcance = scope.warehouseIds === "all" ? null : scope.warehouseIds;
      const soloAlmacen = options.warehouseId ?? null;

      const rows = await tx.$queryRaw<KardexRawRow[]>`
        WITH historico AS (
          SELECT
            m.*,
            SUM(CASE m.direction WHEN 'entry' THEN m.quantity ELSE -m.quantity END)
              OVER (PARTITION BY m.warehouse_id ORDER BY m.created_at, m.seq)
              AS balance_after
          FROM stock_movements m
          WHERE m.tenant_id = ${user.tenantId}::uuid
            AND m.product_id = ${productId}::uuid
            AND (${alcance}::uuid[] IS NULL OR m.warehouse_id = ANY(${alcance}::uuid[]))
        ),
        filtrado AS (
          SELECT * FROM historico h
           WHERE (${soloAlmacen}::uuid IS NULL OR h.warehouse_id = ${soloAlmacen}::uuid)
             AND (${desde}::timestamptz IS NULL OR h.created_at >= ${desde}::timestamptz)
             AND (${hasta}::timestamptz IS NULL OR h.created_at < ${hasta}::timestamptz)
             AND (${options.direction ?? null}::text IS NULL OR h.direction::text = ${options.direction ?? null}::text)
             AND (${options.reasonCode ?? null}::text IS NULL OR h.reason_code::text = ${options.reasonCode ?? null}::text)
             AND (${options.lotId ?? null}::uuid IS NULL OR h.lot_id = ${options.lotId ?? null}::uuid)
        )
        SELECT
          f.id,
          f.created_at,
          f.direction,
          f.reason_code,
          f.reason_note,
          f.reference,
          f.quantity::text AS quantity,
          f.unit_cost::text AS unit_cost,
          f.location,
          f.balance_after::text AS balance_after,
          COALESCE(f.document_id, f.sale_id) AS document_id,
          COALESCE(d.folio, s.folio) AS folio,
          COALESCE(d.type::text, 'sale') AS document_type,
          COALESCE(d.status::text, s.status::text) AS document_status,
          f.warehouse_id,
          w.name AS warehouse_name,
          f.linked_warehouse_id,
          lw.name AS linked_warehouse_name,
          f.presentation_id,
          p.name AS presentation_name,
          p.factor::text AS presentation_factor,
          f.lot_id,
          pl.lot_code,
          pl.expires_at AS lot_expires_at,
          f.parent_product_id,
          pp.sku AS parent_sku,
          pp.name AS parent_name,
          f.created_by,
          TRIM(u.first_name || ' ' || u.last_name_paternal) AS created_by_name,
          COUNT(*) OVER () AS total
        FROM filtrado f
        -- LEFT y no INNER: desde F4-SALE-01 un movimiento cuelga de un
        -- documento **o** de una venta. Con el INNER de antes, cada línea de
        -- venta habría DESAPARECIDO del kardex sin un solo error — el peor
        -- fallo posible en un libro de inventario: no uno que grita, uno que
        -- calla. El CHECK de la base garantiza que siempre hay exactamente uno.
        LEFT JOIN inventory_documents d ON d.id = f.document_id
        LEFT JOIN sales s ON s.id = f.sale_id
        JOIN warehouses w ON w.id = f.warehouse_id
        JOIN users u ON u.id = f.created_by
        LEFT JOIN warehouses lw ON lw.id = f.linked_warehouse_id
        LEFT JOIN product_presentations p ON p.id = f.presentation_id
        LEFT JOIN product_lots pl ON pl.id = f.lot_id
        LEFT JOIN products pp ON pp.id = f.parent_product_id
        ORDER BY f.created_at DESC, f.seq DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

      return {
        rows: rows.map((row) => this.toRow(row)),
        // `COUNT(*) OVER ()` viene como BigInt: se convierte acá porque
        // `JSON.stringify` no sabe serializarlo y tira `TypeError`.
        total: rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0,
        page,
        pageSize,
        isComposite: product.isComposite,
      };
    });
  }

  /**
   * F3-KARDEX-03 — dónde está el stock de un producto.
   *
   * Devuelve **una fila por almacén del alcance, incluidos los que están en
   * cero**. Un almacén sin fila en `stock_by_warehouse` no significa "no
   * existe" sino "nunca hubo": sin esas filas, quien mira no puede distinguir
   * un producto que jamás llegó a esa bodega de uno que se agotó ahí, y esas
   * dos cosas piden decisiones distintas.
   *
   * Un COMPUESTO no tiene saldo propio —se arma al consumirlo—, así que
   * responde con sus unidades armables y el componente que las limita.
   */
  async stock(user: AuthUser, scope: UserScope, productId: string, warehouseId?: string) {
    if (warehouseId !== undefined) {
      assertWarehouseInScope(scope, warehouseId);
    }

    const producto = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.product.findFirst({
        where: { id: productId, tenantId: user.tenantId },
        select: { id: true, isComposite: true, tracksLots: true, stockMin: true, baseUnit: true },
      }),
    );
    if (producto === null) {
      throw new NotFoundException({ message: "products.not_found" });
    }

    if (producto.isComposite) {
      const availability = await this.composition.availability(user, productId, warehouseId);
      return {
        isComposite: true,
        rows: [],
        total: "0",
        stockMin: producto.stockMin.toString(),
        belowMin: false,
        baseUnit: producto.baseUnit,
        availability: {
          units: availability.units,
          limitingComponent: availability.limitedBy,
        },
      };
    }

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const almacenes = await tx.warehouse.findMany({
        where: {
          tenantId: user.tenantId,
          isActive: true,
          ...(warehouseId !== undefined ? { id: warehouseId } : {}),
          ...(scope.warehouseIds === "all" ? {} : { id: { in: scope.warehouseIds } }),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
      const ids = almacenes.map((w) => w.id);

      const [saldos, lotes] = await Promise.all([
        tx.stockByWarehouse.findMany({
          where: { productId, warehouseId: { in: ids } },
          select: { warehouseId: true, quantity: true, updatedAt: true },
        }),
        producto.tracksLots
          ? tx.stockLot.findMany({
              where: { warehouseId: { in: ids }, quantity: { gt: 0 }, lot: { productId } },
              select: {
                location: true,
                quantity: true,
                warehouseId: true,
                lot: { select: { id: true, lotCode: true, expiresAt: true } },
              },
              // FEFO: el primero es el que se descuenta primero. Mismo orden
              // que `resolveLotsFefo` — otro haría que la pantalla contradiga
              // al ledger.
              orderBy: [
                { lot: { expiresAt: { sort: "asc", nulls: "last" } } },
                { lot: { lotCode: "asc" } },
                { location: "asc" },
              ],
            })
          : Promise.resolve([]),
      ]);

      const saldoPorAlmacen = new Map(saldos.map((s) => [s.warehouseId, s]));
      // Dos fechas de corte, no una. `expiringSoon` se calculaba solo con
      // `expiresAt <= hoy+30`, y una fecha del PASADO también cumple eso: un
      // lote vencido hace un año salía marcado «vence pronto». No es cosmético
      // — FEFO lo despacha PRIMERO, así que es justo el que alguien va a dejar
      // salir creyendo que todavía sirve.
      const hoy = new Date();
      hoy.setUTCHours(0, 0, 0, 0);
      const enTreintaDias = new Date(hoy);
      enTreintaDias.setUTCDate(enTreintaDias.getUTCDate() + 30);

      const rows = almacenes.map((warehouse) => {
        const saldo = saldoPorAlmacen.get(warehouse.id);
        const suyos = lotes.filter((l) => l.warehouseId === warehouse.id);

        return {
          warehouseId: warehouse.id,
          name: warehouse.name,
          quantity: saldo?.quantity.toString() ?? "0",
          // `null` y no una fecha inventada: nunca se movió nada acá.
          updatedAt: saldo?.updatedAt ?? null,
          ...(producto.tracksLots
            ? {
                lots: suyos.map((l) => ({
                  lotId: l.lot.id,
                  lotCode: l.lot.lotCode,
                  expiresAt: l.lot.expiresAt,
                  location: l.location,
                  quantity: l.quantity.toString(),
                  // El día que vence todavía sirve: vencido es ESTRICTAMENTE
                  // anterior a hoy. Los dos estados son excluyentes.
                  expired: l.lot.expiresAt !== null && l.lot.expiresAt < hoy,
                  expiringSoon:
                    l.lot.expiresAt !== null &&
                    l.lot.expiresAt >= hoy &&
                    l.lot.expiresAt <= enTreintaDias,
                })),
              }
            : {}),
        };
      });

      const total = rows.reduce(
        (acc, row) => acc.plus(new Prisma.Decimal(row.quantity)),
        new Prisma.Decimal(0),
      );
      const stockMin = new Prisma.Decimal(producto.stockMin.toString());

      return {
        isComposite: false,
        rows,
        total: total.toString(),
        stockMin: stockMin.toString(),
        // El mínimo se compara contra lo que el usuario PUEDE ver: para un
        // Manager de una bodega, "bajo mínimo" es sobre la suya.
        belowMin: stockMin.greaterThan(0) && total.lessThan(stockMin),
        baseUnit: producto.baseUnit,
      };
    });
  }

  /**
   * F3-KARDEX-04 — stock que salió del origen y todavía no se confirmó.
   *
   * El alcance mira el **origen**: es mercancía que salió de MI bodega y de la
   * que sigo siendo responsable hasta que alguien la reciba. Quien solo
   * administra el destino no tiene stock en tránsito — lo suyo son los
   * traspasos entrantes, que son otra pantalla.
   *
   * No hay parciales: un traspaso está en tránsito o no está. Recibido o
   * cancelado, desaparece.
   */
  async inTransit(
    user: AuthUser,
    scope: UserScope,
    options: { productId?: string; originWarehouseId?: string } = {},
  ) {
    if (options.originWarehouseId !== undefined) {
      assertWarehouseInScope(scope, options.originWarehouseId);
    }

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const lineas = await tx.transferLine.findMany({
        where: {
          tenantId: user.tenantId,
          ...(options.productId !== undefined ? { productId: options.productId } : {}),
          transfer: {
            status: "in_transit",
            ...(options.originWarehouseId !== undefined
              ? { originWarehouseId: options.originWarehouseId }
              : scope.warehouseIds === "all"
                ? {}
                : { originWarehouseId: { in: scope.warehouseIds } }),
          },
        },
        select: {
          transferId: true,
          productId: true,
          quantitySent: true,
          product: { select: { sku: true, name: true, baseUnit: true } },
        },
      });

      const porProducto = new Map<
        string,
        {
          productId: string;
          sku: string;
          name: string;
          baseUnit: string;
          quantity: Prisma.Decimal;
          transfers: Set<string>;
        }
      >();
      for (const linea of lineas) {
        const actual = porProducto.get(linea.productId) ?? {
          productId: linea.productId,
          sku: linea.product.sku,
          name: linea.product.name,
          baseUnit: linea.product.baseUnit,
          quantity: new Prisma.Decimal(0),
          transfers: new Set<string>(),
        };
        actual.quantity = actual.quantity.plus(linea.quantitySent);
        actual.transfers.add(linea.transferId);
        porProducto.set(linea.productId, actual);
      }

      return {
        rows: [...porProducto.values()]
          .map((row) => ({
            productId: row.productId,
            sku: row.sku,
            name: row.name,
            baseUnit: row.baseUnit,
            quantity: row.quantity.toString(),
            transfers: row.transfers.size,
          }))
          .sort((a, b) => a.sku.localeCompare(b.sku)),
      };
    });
  }

  /**
   * `seq` NO sale en la respuesta: es `BigInt` y `JSON.stringify` revienta con
   * él. Sirve para ORDENAR, que es lo único para lo que existe.
   */
  private toRow(row: KardexRawRow) {
    const factor = row.presentation_factor;

    return {
      id: row.id,
      createdAt: row.created_at,
      direction: row.direction,
      reasonCode: row.reason_code,
      reasonNote: row.reason_note,
      reference: row.reference,
      quantity: row.quantity,
      unitCost: row.unit_cost,
      location: row.location,
      balanceAfter: row.balance_after,
      document: {
        id: row.document_id,
        folio: row.folio,
        type: row.document_type,
        status: row.document_status,
      },
      warehouse: { id: row.warehouse_id, name: row.warehouse_name },
      linkedWarehouse:
        row.linked_warehouse_id === null
          ? null
          : { id: row.linked_warehouse_id, name: row.linked_warehouse_name },
      presentation:
        row.presentation_id === null || factor === null
          ? null
          : {
              id: row.presentation_id,
              name: row.presentation_name,
              factor,
              // Lo que la persona TECLEÓ, reconstruido: el movimiento se
              // guarda en unidad base, pero quien lee el kardex capturó cajas.
              quantityInPresentation: new Prisma.Decimal(row.quantity)
                .dividedBy(new Prisma.Decimal(factor))
                .toString(),
            },
      lot:
        row.lot_id === null
          ? null
          : { id: row.lot_id, lotCode: row.lot_code, expiresAt: row.lot_expires_at },
      parentProduct:
        row.parent_product_id === null
          ? null
          : { id: row.parent_product_id, sku: row.parent_sku, name: row.parent_name },
      createdBy: { id: row.created_by, name: row.created_by_name },
    };
  }
}

/**
 * La zona horaria del negocio, para traducir días del calendario a instantes.
 *
 * Se consulta por listado y no se cachea: es UNA fila por `id` con índice
 * primario —lo más barato que hace Postgres— y cachearla obligaría a invalidar
 * cuando el tenant cambie de zona, que es justo el momento en que un valor
 * viejo daría un rango equivocado sin que nadie lo note.
 */
async function zonaDelNegocio(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  });
  return tenant?.timezone ?? "UTC";
}
