import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { WeightedCostService } from "../cost/weighted-cost.service";
import { assertWarehouseInScope } from "../inventory/warehouse-scope.helpers";
import type { StockReportQueryDto } from "./dto/stock-report.dto";

export interface StockReportRow {
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  stockMin: string;
  /** El TOTAL del producto en todos los almacenes del alcance. */
  totalQuantity: string;
  belowMin: boolean;
  /** `null` sin historial de compras: ver `WeightedCostService`. */
  avgCost: string | null;
  totalValue: string | null;
}

export interface StockLotReportRow {
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  warehouseId: string;
  warehouseName: string;
  /** Vacío en la fila sin lote: ver `unlotted`. */
  lotCode: string;
  /** `null` en los rubros que manejan lote sin vencimiento, y sin lote. */
  expiresAt: string | null;
  location: string;
  quantity: string;
  /**
   * La fila de lo que NO tiene lote (Carlos, 2026-10-31): el saldo de la
   * sucursal menos lo que está en lotes. Va sin código, sin caducidad y sin
   * ubicación, porque ninguna de las tres existe para ese saldo.
   */
  unlotted: boolean;
}

/** `%`, `_` y `\` valen como texto literal dentro de un LIKE. */
function likePattern(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * F5-STK — el stock visto al revés.
 *
 * Hasta hoy el stock solo se podía preguntar producto por producto (la tab de
 * la ficha). Este servicio hace la pregunta transversal —«qué hay en mis
 * bodegas»— y eso trae tres cosas que la ficha no necesitaba:
 *
 *  1. **Alcance por almacén.** Un Manager de una bodega no puede enterarse de
 *     lo que hay en otra: se filtra por el alcance SIEMPRE, y pedir un almacén
 *     de afuera es 403 y no una lista vacía —«ese almacén no tiene nada» sería
 *     una mentira, no una respuesta—.
 *  2. **Orden estable.** Con desempate por las dos columnas de la clave: sin
 *     él, dos filas empatadas quedan en el orden que Postgres decida y ese
 *     orden cambia entre consultas, así que una fila puede salir en dos
 *     páginas o en ninguna.
 *  3. **Valorización.** Con el promedio ponderado de F5-COST-01.
 *
 * ── Qué significa `belowMin` ────────────────────────────────────────────
 *
 * `stock_min` es un umbral GLOBAL del producto —«no quiero tener menos de 100
 * en total»—, no un umbral por bodega. Así que `belowMin` compara contra el
 * TOTAL, igual que el kardex, y no contra el saldo de cada fila. Es lo que
 * responde la pregunta de reposición: qué hay que comprar. Las filas siguen
 * mostrando DÓNDE está ese stock, que es la otra mitad de la respuesta.
 *
 * Aplicarlo por fila daría un falso positivo tentador: tres bodegas con 40
 * cada una y un mínimo de 100 marcarían las tres en rojo aunque haya 120.
 */
@Injectable()
export class StockReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weightedCost: WeightedCostService,
  ) {}

  async list(
    user: AuthUser,
    scope: UserScope,
    query: StockReportQueryDto,
  ): Promise<{ rows: StockReportRow[]; total: number; page: number; pageSize: number }> {
    const bajoMinimo = query.belowMin
      ? await this.productosBajoMinimo(user.tenantId, scope)
      : undefined;
    const where = this.where(scope, query, bajoMinimo);

    const [total, filas] = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const conteo = await tx.stockByWarehouse.count({ where });
      const rows = await tx.stockByWarehouse.findMany({
        where,
        include: {
          product: { select: { sku: true, name: true, baseUnit: true, stockMin: true } },
          warehouse: { select: { name: true } },
        },
        // El desempate NO es estético: ver la nota 2 del docblock.
        orderBy: [{ product: { name: "asc" } }, { productId: "asc" }, { warehouseId: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return [conteo, rows] as const;
    });

    const productIds = [...new Set(filas.map((f) => f.productId))];
    const [promedios, totales] = await Promise.all([
      this.weightedCost.averageCosts(user.tenantId, productIds),
      this.totalPorProducto(user.tenantId, scope, productIds),
    ]);

    return {
      rows: filas.map((fila) => {
        const stockMin = new Prisma.Decimal(fila.product.stockMin.toString());
        const totalProducto = totales.get(fila.productId) ?? new Prisma.Decimal(0);
        const promedio = promedios.get(fila.productId) ?? null;

        return {
          productId: fila.productId,
          sku: fila.product.sku,
          name: fila.product.name,
          baseUnit: fila.product.baseUnit,
          warehouseId: fila.warehouseId,
          warehouseName: fila.warehouse.name,
          quantity: fila.quantity.toString(),
          stockMin: stockMin.toString(),
          totalQuantity: totalProducto.toString(),
          // Un mínimo en cero significa «no llevo control», no «todo es poco».
          belowMin: stockMin.greaterThan(0) && totalProducto.lessThan(stockMin),
          avgCost: promedio === null ? null : promedio.toFixed(2),
          // Sin costo NO hay valor: un 0 se sumaría al total del inventario y
          // lo haría mentir. La celda vacía dice «no sé», que es la verdad.
          totalValue: promedio === null ? null : promedio.mul(fila.quantity).toFixed(2),
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * F5-STK-05 — el detalle por lote y ubicación.
   *
   * **La ubicación PARTE el stock**: es parte de la clave primaria de
   * `stock_lots`, así que «12 en A-1 y 8 en B-2» son dos filas y no una fila
   * con una etiqueta. Quien va a buscar la mercancía necesita saber a qué
   * estante ir (directiva de Carlos, 2026-08-24).
   *
   * **Lo que no tiene lote también es una fila** (Carlos, 2026-10-31). Un
   * producto con lote puede tener existencias sin lote —lo que había antes de
   * encender el control—, y ese saldo no vive en `stock_lots`: es el de la
   * sucursal menos lo que está en lotes. Leyendo solo `stock_lots`, una
   * farmacia con 777 productos así no los veía en el detalle. Va como una
   * fila más del mismo producto y sucursal, sin código ni caducidad, al final
   * de las que no vencen.
   *
   * **Un lote agotado ya no es fila.** Vender un lote entero lo deja en
   * `stock_lots` con cero; el detalle pintaba un «0» por cada partida agotada,
   * que nadie va a ir a buscar al estante. La pestaña del producto ya los
   * dejaba fuera.
   */
  async listLots(
    user: AuthUser,
    scope: UserScope,
    query: StockReportQueryDto,
  ): Promise<{ rows: StockLotReportRow[]; total: number; page: number; pageSize: number }> {
    const desde = this.detalleDesde(user.tenantId, scope, query);

    const [total, filas] = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [conteo] = await tx.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total ${desde}`;
      // FEFO primero —lo que vence antes va arriba— y después el desempate
      // por las tres columnas de la clave. Lo que no vence va al final (NULLS
      // LAST, como el ASC de siempre) y, entre eso, la fila sin lote después
      // de los lotes, por producto y sucursal. El nombre y el producto NO
      // mueven las filas de lote: un lote es de un solo producto.
      const rows = await tx.$queryRaw<
        {
          product_id: string;
          sku: string;
          name: string;
          base_unit: string;
          warehouse_id: string;
          warehouse_name: string;
          lot_code: string | null;
          expires_at: string | null;
          location: string;
          quantity: string;
          unlotted: boolean;
        }[]
      >`
        SELECT d.product_id, p.sku, p.name, p.base_unit, d.warehouse_id,
               w.name AS warehouse_name, d.lot_code,
               to_char(d.expires_at, 'YYYY-MM-DD') AS expires_at, d.location,
               d.quantity::text AS quantity, d.lot_id IS NULL AS unlotted
        ${desde}
         ORDER BY d.expires_at ASC NULLS LAST, d.lot_id ASC NULLS LAST, p.name ASC,
                  d.product_id ASC, d.warehouse_id ASC, d.location ASC
         LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
      return [conteo?.total ?? 0, rows] as const;
    });

    return {
      rows: filas.map((fila) => ({
        productId: fila.product_id,
        sku: fila.sku,
        name: fila.name,
        baseUnit: fila.base_unit,
        warehouseId: fila.warehouse_id,
        warehouseName: fila.warehouse_name,
        lotCode: fila.lot_code ?? "",
        // Solo la fecha (el `to_char`): la hora de un vencimiento no
        // significa nada.
        expiresAt: fila.expires_at,
        location: fila.location,
        // Por `Decimal` para que salga como antes: «13» y no el «13.0000» de
        // la columna.
        quantity: new Prisma.Decimal(fila.quantity).toString(),
        unlotted: fila.unlotted,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Cuántas filas dejarían los filtros. Lo consume el tope del export. */
  async count(user: AuthUser, scope: UserScope, query: StockReportQueryDto): Promise<number> {
    if (query.detail === "lots") {
      const desde = this.detalleDesde(user.tenantId, scope, query);
      const [conteo] = await this.prisma.withTenantContext(
        user.tenantId,
        (tx) => tx.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${desde}`,
      );
      return conteo?.total ?? 0;
    }

    const bajoMinimo = query.belowMin
      ? await this.productosBajoMinimo(user.tenantId, scope)
      : undefined;
    return this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.stockByWarehouse.count({ where: this.where(scope, query, bajoMinimo) }),
    );
  }

  /**
   * Los productos cuyo total —sobre los almacenes del alcance— quedó por
   * debajo de su `stock_min`.
   *
   * Se resuelve en una consulta agregada aparte y no dentro del `where`
   * porque la condición es sobre una SUMA de varias filas, no sobre una fila.
   * `stock_min = 0` significa «no llevo control», no «todo es poco»: esos
   * productos no pueden estar bajo mínimo.
   */
  private async productosBajoMinimo(tenantId: string, scope: UserScope): Promise<string[]> {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const conMinimo = await tx.product.findMany({
        where: { tenantId, stockMin: { gt: 0 } },
        select: { id: true, stockMin: true },
      });
      if (conMinimo.length === 0) {
        return [];
      }

      const sumas = await tx.stockByWarehouse.groupBy({
        by: ["productId"],
        where: {
          productId: { in: conMinimo.map((p) => p.id) },
          ...(scope.warehouseIds === "all" ? {} : { warehouseId: { in: scope.warehouseIds } }),
        },
        _sum: { quantity: true },
      });
      const totalPorProducto = new Map(
        sumas.map((s) => [s.productId, new Prisma.Decimal((s._sum.quantity ?? 0).toString())]),
      );

      return conMinimo
        .filter((producto) => {
          const total = totalPorProducto.get(producto.id) ?? new Prisma.Decimal(0);
          return total.lessThan(new Prisma.Decimal(producto.stockMin.toString()));
        })
        .map((producto) => producto.id);
    });
  }

  /**
   * El `where` de la consulta principal.
   *
   * `bajoMinimo` llega YA RESUELTO —la lista de productos cuyo total está bajo
   * su umbral— y no como una condición. Tiene que ser así: el criterio compara
   * contra la SUMA de todos los almacenes, y aplicarlo fila por fila después
   * de paginar dejaría un `count` que promete más filas de las que el filtro
   * deja. Un paginador que miente es peor que un filtro lento.
   */
  private where(scope: UserScope, query: StockReportQueryDto, bajoMinimo?: readonly string[]) {
    if (query.warehouseId !== undefined) {
      assertWarehouseInScope(scope, query.warehouseId);
    }

    const filtroProducto = {
      ...(query.search !== undefined && {
        OR: [
          { sku: { contains: query.search, mode: "insensitive" as const } },
          { name: { contains: query.search, mode: "insensitive" as const } },
        ],
      }),
    };

    return {
      ...(query.warehouseId !== undefined
        ? { warehouseId: query.warehouseId }
        : scope.warehouseIds === "all"
          ? {}
          : // Lista vacía → `in: []`, que no devuelve nada. Un `where` vacío
            // significaría «todos», justo lo contrario del scope vacío.
            { warehouseId: { in: scope.warehouseIds } }),
      // Las dos condiciones sobre el producto van en UNA sola clave: dos
      // `product:` en el mismo objeto se pisan en silencio y el filtro que
      // quedó atrás simplemente deja de existir.
      ...(Object.keys(filtroProducto).length > 0 && { product: filtroProducto }),
      ...(bajoMinimo !== undefined && { productId: { in: [...bajoMinimo] } }),
    };
  }

  /**
   * El `FROM … WHERE` del detalle por lote, el MISMO para contar y para traer
   * la página: si fueran dos, el paginador prometería filas que no llegan.
   *
   * Son dos fuentes en una: las filas de `stock_lots` con existencia y, por
   * cada producto con lote y sucursal, lo que su saldo tiene de más sobre la
   * suma de sus lotes. La suma va sobre TODOS los lotes —también los agotados
   * o en negativo— porque es la que dice cuánto del saldo NO tiene lote; las
   * filas que se muestran siguen siendo solo las que tienen existencia.
   *
   * Solo los productos que manejan lote dan fila sin lote: en los demás TODO
   * es «sin lote» y el detalle por lote no es su lugar.
   */
  private detalleDesde(tenantId: string, scope: UserScope, query: StockReportQueryDto) {
    if (query.warehouseId !== undefined) {
      assertWarehouseInScope(scope, query.warehouseId);
    }

    // Lista vacía → `= ANY('{}')`, que no devuelve nada: un alcance vacío no
    // es «todos».
    const enAlcance = (columna: Prisma.Sql) =>
      query.warehouseId !== undefined
        ? Prisma.sql`AND ${columna} = ${query.warehouseId}::uuid`
        : scope.warehouseIds === "all"
          ? Prisma.empty
          : Prisma.sql`AND ${columna} = ANY(${[...scope.warehouseIds]}::uuid[])`;
    const busqueda =
      query.search === undefined
        ? Prisma.empty
        : Prisma.sql`AND (p.sku ILIKE ${likePattern(query.search)}
                          OR p.name ILIKE ${likePattern(query.search)})`;

    return Prisma.sql`
      FROM (
        SELECT pl.product_id, sl.warehouse_id, sl.lot_id, pl.lot_code, pl.expires_at,
               sl.location, sl.quantity
          FROM stock_lots sl
          JOIN product_lots pl ON pl.id = sl.lot_id
         WHERE sl.tenant_id = ${tenantId}::uuid
           AND sl.quantity > 0
           ${enAlcance(Prisma.sql`sl.warehouse_id`)}
        UNION ALL
        SELECT sbw.product_id, sbw.warehouse_id, NULL::uuid, NULL, NULL::date,
               '', sbw.quantity - COALESCE(en_lotes.quantity, 0)
          FROM stock_by_warehouse sbw
          JOIN products con_lote ON con_lote.id = sbw.product_id AND con_lote.tracks_lots
          LEFT JOIN (
            SELECT pl.product_id, sl.warehouse_id, SUM(sl.quantity) AS quantity
              FROM stock_lots sl
              JOIN product_lots pl ON pl.id = sl.lot_id
             WHERE sl.tenant_id = ${tenantId}::uuid
               ${enAlcance(Prisma.sql`sl.warehouse_id`)}
             GROUP BY pl.product_id, sl.warehouse_id
          ) en_lotes ON en_lotes.product_id = sbw.product_id
                    AND en_lotes.warehouse_id = sbw.warehouse_id
         WHERE sbw.tenant_id = ${tenantId}::uuid
           AND sbw.quantity - COALESCE(en_lotes.quantity, 0) > 0
           ${enAlcance(Prisma.sql`sbw.warehouse_id`)}
      ) d
      JOIN products p ON p.id = d.product_id
      JOIN warehouses w ON w.id = d.warehouse_id
     WHERE TRUE ${busqueda}`;
  }

  /**
   * El total de cada producto SUMANDO solo los almacenes del alcance.
   *
   * Sumar los de afuera filtraría por la ventana del `belowMin` información
   * que el usuario no puede ver: «tu producto no está bajo mínimo» le diría
   * que hay stock en una bodega que no administra.
   */
  private async totalPorProducto(
    tenantId: string,
    scope: UserScope,
    productIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (productIds.length === 0) {
      return new Map();
    }

    const filas = await this.prisma.withTenantContext(tenantId, (tx) =>
      tx.stockByWarehouse.groupBy({
        by: ["productId"],
        where: {
          productId: { in: [...productIds] },
          ...(scope.warehouseIds === "all" ? {} : { warehouseId: { in: scope.warehouseIds } }),
        },
        _sum: { quantity: true },
      }),
    );

    return new Map(
      filas.map((fila) => [
        fila.productId,
        new Prisma.Decimal((fila._sum.quantity ?? 0).toString()),
      ]),
    );
  }
}
