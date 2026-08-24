import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { WeightedCostService } from "../cost/weighted-cost.service";
import { findCompositionCycle } from "./composition-graph";
import type { ReplaceCompositionDto } from "./dto/replace-composition.dto";

export interface AvailabilityResult {
  /** Cuántas unidades del compuesto se pueden armar con el stock actual. */
  units: number;
  limitedBy: { productId: string; sku: string; name: string } | null;
}

export interface CostEstimateResult {
  total: string;
  lines: {
    productId: string;
    sku: string;
    name: string;
    quantity: string;
    cost: string;
    /**
     * De dónde salió el número (F5-COST-02): `weighted` es el promedio de las
     * COMPRAS reales; `presentation` es el precio de lista de la presentación
     * de compra, el fallback para lo que nunca se compró.
     *
     * Va por COMPONENTE y no por documento porque un compuesto mezcla los dos
     * casos: el azúcar con historial y el vaso que nadie compró todavía. Sin
     * esto, el total es un número sin procedencia.
     */
    source: "weighted" | "presentation";
  }[];
}

/**
 * F2-BOM-01/02 — el "apartado de relaciones entre productos".
 *
 * Se guarda cuánto de cada componente lleva UNA unidad del compuesto. El
 * "1 kg de azúcar alcanza para 50 cafés" del pedido de Carlos se expresa como
 * "el café lleva 20 gr de azúcar", y el N se CALCULA contra el stock cada vez
 * que alguien pregunta — guardarlo como número fijo mentiría apenas cambiara
 * el inventario.
 */
@Injectable()
export class CompositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly weightedCost: WeightedCostService,
  ) {}

  async get(user: AuthUser, productId: string) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findProductOrFail(tx, user, productId);
      return tx.productComposition.findMany({
        where: { parentProductId: productId },
        include: { component: { select: { id: true, sku: true, name: true, baseUnit: true } } },
      });
    });
  }

  /**
   * Reemplaza la composición COMPLETA (no es un delta): la UI edita una tabla
   * y guarda lo que quedó. Un delta obligaría al front a llevar la cuenta de
   * qué borró, que es justo donde se cuelan los bugs.
   */
  async replace(
    user: AuthUser,
    productId: string,
    input: ReplaceCompositionDto,
    meta: RequestMeta,
  ) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findProductOrFail(tx, user, productId);

      const componentIds = input.lines.map((line) => line.componentId);

      // Todos los componentes tienen que ser productos del MISMO tenant: la
      // FK lo garantizaría, pero con un error ilegible.
      const found = await tx.product.findMany({
        where: { id: { in: componentIds }, tenantId: user.tenantId },
        select: { id: true },
      });
      if (found.length !== new Set(componentIds).size) {
        throw new ConflictException({ message: "products.component_not_found" });
      }

      // DFS sobre el grafo COMPLETO del tenant con las aristas propuestas.
      const existing = await tx.productComposition.findMany({
        select: { parentProductId: true, componentProductId: true },
      });
      const edges = new Map<string, string[]>();
      for (const row of existing) {
        edges.set(row.parentProductId, [
          ...(edges.get(row.parentProductId) ?? []),
          row.componentProductId,
        ]);
      }

      const cycle = findCompositionCycle(edges, productId, componentIds);
      if (cycle) {
        const names = await tx.product.findMany({
          where: { id: { in: cycle } },
          select: { id: true, sku: true, name: true },
        });
        throw new ConflictException({
          message: "products.composition_cycle",
          cycle: cycle.map((id) => names.find((product) => product.id === id) ?? { id }),
        });
      }

      await tx.productComposition.deleteMany({ where: { parentProductId: productId } });
      if (input.lines.length > 0) {
        await tx.productComposition.createMany({
          data: input.lines.map((line) => ({
            tenantId: user.tenantId,
            parentProductId: productId,
            componentProductId: line.componentId,
            quantity: line.quantity,
            wastePercentage: line.wastePercentage,
            notes: line.notes ?? null,
          })),
        });
      }

      // Un producto CON composición es compuesto por definición: se mantiene
      // el flag denormalizado en sincronía acá y no en el caller, que podría
      // olvidarlo.
      await tx.product.update({
        where: { id: productId },
        data: { isComposite: input.lines.length > 0 },
      });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "products.composition_replace",
        resourceType: "product",
        resourceId: productId,
        after: { lines: input.lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return tx.productComposition.findMany({
        where: { parentProductId: productId },
        include: { component: { select: { id: true, sku: true, name: true, baseUnit: true } } },
      });
    });
  }

  /**
   * F2-BOM-02 — "alcanza para N unidades" + qué componente lo limita.
   *
   * `floor(min(stock_i / (qty_i × (1 + merma_i))))`. Los compuestos anidados
   * se expanden: el "stock" de un componente que a su vez es compuesto es su
   * propia disponibilidad calculada.
   *
   * Con stock 0 devuelve 0: en Fase 2 no hay movimientos todavía, así que ese
   * es el resultado honesto — F3 lo llena.
   */
  async availability(
    user: AuthUser,
    productId: string,
    /**
     * Acota el cálculo a UN almacén. Sin él suma todos, que es lo correcto
     * para la ficha del producto ("cuántos puedo armar en total") pero MENTIRÍA
     * como techo de una línea de movimiento: diría que se pueden armar 10
     * cuando los componentes están en otra bodega (F3-EXIT-02).
     */
    warehouseId?: string,
    /**
     * F3-GUARDS-05: el ALCANCE del usuario. Sin él, un Manager de una bodega
     * vería unidades armables que no puede armar — los componentes están en un
     * almacén que no administra. Distinto de `warehouseId`, que acota a UNO.
     */
    scope?: UserScope,
  ): Promise<AvailabilityResult> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findProductOrFail(tx, user, productId);

      const compositions = await tx.productComposition.findMany({
        include: { component: { select: { id: true, sku: true, name: true, isComposite: true } } },
      });
      const dondePuedeVer =
        warehouseId !== undefined
          ? { warehouseId }
          : scope === undefined || scope.warehouseIds === "all"
            ? undefined
            : { warehouseId: { in: scope.warehouseIds } };

      const stock = await tx.stockByWarehouse.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        ...(dondePuedeVer !== undefined ? { where: dondePuedeVer } : {}),
      });
      const stockByProduct = new Map(
        stock.map((row) => [row.productId, Number(row._sum.quantity ?? 0)]),
      );
      const linesByParent = new Map<string, typeof compositions>();
      for (const row of compositions) {
        linesByParent.set(row.parentProductId, [
          ...(linesByParent.get(row.parentProductId) ?? []),
          row,
        ]);
      }

      // `visiting` corta cualquier ciclo que hubiera quedado en datos viejos:
      // este cálculo no puede ser el que tire la app abajo.
      const memo = new Map<string, number>();
      const visiting = new Set<string>();

      function unitsOf(id: string): number {
        const cached = memo.get(id);
        if (cached !== undefined) {
          return cached;
        }
        if (visiting.has(id)) {
          return 0;
        }

        const lines = linesByParent.get(id) ?? [];
        if (lines.length === 0) {
          // Producto simple: su "disponibilidad" es su stock.
          return stockByProduct.get(id) ?? 0;
        }

        visiting.add(id);
        let best = Number.POSITIVE_INFINITY;
        for (const line of lines) {
          const needed = Number(line.quantity) * (1 + Number(line.wastePercentage) / 100);
          const available = line.component.isComposite
            ? unitsOf(line.component.id)
            : (stockByProduct.get(line.component.id) ?? 0);
          best = Math.min(best, needed > 0 ? available / needed : 0);
        }
        visiting.delete(id);

        const result = Number.isFinite(best) ? Math.max(0, Math.floor(best)) : 0;
        memo.set(id, result);
        return result;
      }

      const lines = linesByParent.get(productId) ?? [];
      if (lines.length === 0) {
        return { units: 0, limitedBy: null };
      }

      let units = Number.POSITIVE_INFINITY;
      let limitedBy: AvailabilityResult["limitedBy"] = null;

      for (const line of lines) {
        const needed = Number(line.quantity) * (1 + Number(line.wastePercentage) / 100);
        const available = line.component.isComposite
          ? unitsOf(line.component.id)
          : (stockByProduct.get(line.component.id) ?? 0);
        const possible = needed > 0 ? available / needed : 0;

        if (possible < units) {
          units = possible;
          limitedBy = {
            productId: line.component.id,
            sku: line.component.sku,
            name: line.component.name,
          };
        }
      }

      return { units: Math.max(0, Math.floor(units)), limitedBy };
    });
  }

  /**
   * F2-BOM-02 — costo estimado de armar una unidad.
   *
   * El costo unitario de un componente sale de su presentación COMPRABLE
   * predeterminada: `cost / factor` lo lleva a la unidad base. F3 lo va a
   * reemplazar por el promedio ponderado de las compras reales — hasta
   * entonces esto es una estimación y el nombre lo dice.
   */
  async costEstimate(user: AuthUser, productId: string): Promise<CostEstimateResult> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findProductOrFail(tx, user, productId);

      const lines = await tx.productComposition.findMany({
        where: { parentProductId: productId },
        include: {
          component: {
            select: {
              id: true,
              sku: true,
              name: true,
              presentations: {
                where: { isPurchasable: true, isActive: true, cost: { not: null } },
                orderBy: [{ isDefaultSale: "desc" }, { factor: "asc" }],
                take: 1,
                select: { cost: true, factor: true },
              },
            },
          },
        },
      });

      // Los promedios de TODOS los componentes en una consulta: preguntar de
      // a uno sería un N+1 contra el libro mayor por cada renglón del BOM.
      const promedios = await this.weightedCost.averageCosts(
        user.tenantId,
        lines.map((line) => line.component.id),
      );

      let total = 0;
      const detail = lines.map((line) => {
        // El promedio de las compras REALES manda sobre el precio de lista:
        // lo segundo es lo que alguien tecleó alguna vez, lo primero es lo que
        // de verdad se pagó. El fallback existe porque un componente recién
        // dado de alta no tiene historial, y ahí la lista es lo único que hay
        // — mejor una estimación declarada que ningún número.
        const ponderado = promedios.get(line.component.id);
        const presentation = line.component.presentations[0];
        const source = ponderado !== undefined ? ("weighted" as const) : ("presentation" as const);
        const unitCost =
          ponderado !== undefined
            ? Number(ponderado)
            : presentation
              ? Number(presentation.cost) / Number(presentation.factor)
              : 0;
        const lineCost = unitCost * Number(line.quantity);
        total += lineCost;

        return {
          productId: line.component.id,
          sku: line.component.sku,
          name: line.component.name,
          quantity: line.quantity.toString(),
          cost: lineCost.toFixed(2),
          source,
        };
      });

      return { total: total.toFixed(2), lines: detail };
    });
  }

  private async findProductOrFail(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    productId: string,
  ): Promise<{ id: string }> {
    const product = await tx.product.findFirst({
      where: { id: productId, tenantId: user.tenantId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException({ message: "products.not_found" });
    }

    return product;
  }
}
