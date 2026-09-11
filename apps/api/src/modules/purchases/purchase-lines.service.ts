import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { contextoFiscal } from "../pos/tax-resolver";
import type { GrupoResuelto } from "../pos/totals";
import type {
  PurchaseChargeDto,
  PurchaseLineDto,
  ReplacePurchaseChargesDto,
  ReplacePurchaseLinesDto,
} from "./dto/purchase.dto";
import { aplicarReglasDeLote } from "./lot-rules";
import { armarCompra, costoNetoPorUnidad } from "./purchase-totals";
import { type PurchaseDetail, PurchasesService } from "./purchases.service";

const CERO = new Prisma.Decimal(0);

/** Una línea lista para el sumador, con su grupo YA resuelto y su snapshot. */
export interface LineaLista {
  productId: string;
  presentationId: string | null;
  quantity: Prisma.Decimal | null;
  unitCost: Prisma.Decimal | null;
  discount: Prisma.Decimal;
  grupo: GrupoResuelto | null;
  lotCode: string | null;
  expiresAt: Date | null;
  description: string;
}

export interface CargoListo {
  description: string;
  amount: Prisma.Decimal;
  grupo: GrupoResuelto | null;
}

/**
 * F9-PURCH-06 — las líneas y los cargos de la compra, en BLOQUE.
 *
 * ── Por qué en bloque y no línea por línea ──────────────────────────────
 *
 * Cada guardado RECOMPONE `purchase_taxes`: los componentes se acumulan desde
 * todas las partidas, así que tocar una línea cambia el desglose entero. Con
 * un endpoint por línea habría que recalcular igual en cada llamada y, entre
 * dos de ellas, el documento quedaría con impuestos de un estado intermedio
 * que nunca existió en el papel. El `PUT` deja la compra siempre consistente.
 *
 * Los impuestos se BORRAN y se RECREAN, nunca se acumulan: con `createMany`
 * sobre las filas viejas, el segundo guardado chocaría contra el
 * `UNIQUE (purchase_id, code)` — y si no chocara, sumaría el IVA dos veces.
 */
@Injectable()
export class PurchaseLinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchasesService,
    private readonly auditService: AuditService,
  ) {}

  async replaceLines(
    user: AuthUser,
    id: string,
    dto: ReplacePurchaseLinesDto,
    meta: RequestMeta,
  ): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.purchases.assertDraft(tx, user.tenantId, id);
      const lineas = await this.resolverLineas(tx, user.tenantId, dto.lines);
      await this.recomponer(tx, user.tenantId, id, { lineas });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchases.lines",
        resourceType: "purchase",
        resourceId: id,
        after: { lines: dto.lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const refrescada = await this.purchases.buscar(tx, user.tenantId, id);
      return this.detalle(tx, user.tenantId, refrescada.id);
    });
  }

  async replaceCharges(
    user: AuthUser,
    id: string,
    dto: ReplacePurchaseChargesDto,
    meta: RequestMeta,
  ): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.purchases.assertDraft(tx, user.tenantId, id);
      const cargos = await this.resolverCargos(tx, user.tenantId, dto.charges);
      await this.recomponer(tx, user.tenantId, id, { cargos });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchases.charges",
        resourceType: "purchase",
        resourceId: id,
        after: { charges: dto.charges.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detalle(tx, user.tenantId, id);
    });
  }

  /**
   * El corazón del módulo: recalcula la compra ENTERA y reescribe lo que haya
   * cambiado. Lo usan el `PUT` de líneas, el de cargos y el `confirm`, que
   * revalida y recalcula antes de sellar — un solo sumador, un solo lugar
   * donde los totales se escriben.
   *
   * `materializarCosto` lo pide el confirm: es cuando `unit_cost_net` deja de
   * ser un derivado y se congela, porque es el número que va a pisar el
   * catálogo cuando la entrada se confirme.
   */
  async recomponer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchaseId: string,
    opciones: {
      lineas?: LineaLista[];
      cargos?: CargoListo[];
      materializarCosto?: boolean;
    },
  ): Promise<void> {
    const compra = await tx.purchase.findFirstOrThrow({
      where: { id: purchaseId, tenantId },
      include: {
        lines: { orderBy: { lineNo: "asc" } },
        charges: { orderBy: { lineNo: "asc" } },
      },
    });
    const porCodigo = await this.gruposPorCodigo(tx, tenantId);
    const lineas =
      opciones.lineas ??
      compra.lines.map((l) => ({
        productId: l.productId,
        presentationId: l.presentationId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        discount: l.discount,
        grupo: l.taxGroupCode === null ? null : (porCodigo.get(l.taxGroupCode) ?? null),
        lotCode: l.lotCode,
        expiresAt: l.expiresAt,
        description: l.description,
      }));
    const cargos =
      opciones.cargos ??
      compra.charges.map((c) => ({
        description: c.description,
        amount: c.amount,
        grupo: c.taxGroupCode === null ? null : (porCodigo.get(c.taxGroupCode) ?? null),
      }));

    // El modo fiscal es de la COMPRA, no del negocio: la factura del proveedor
    // pudo venir neta aunque el mostrador venda con impuesto incluido.
    const resultado = armarCompraConGrupos(
      lineas,
      cargos,
      compra.taxMode as "included" | "excluded",
    );

    if (opciones.lineas !== undefined) {
      await tx.purchaseLine.deleteMany({ where: { purchaseId, tenantId } });
    }
    if (opciones.cargos !== undefined) {
      await tx.purchaseCharge.deleteMany({ where: { purchaseId, tenantId } });
    }
    // Los impuestos SIEMPRE se rehacen: cualquier cambio los recompone.
    await tx.purchaseTax.deleteMany({ where: { purchaseId, tenantId } });

    if (opciones.lineas !== undefined) {
      await tx.purchaseLine.createMany({
        data: lineas.map((l, i) => {
          const cuenta = resultado.lines[i];
          return {
            tenantId,
            purchaseId,
            lineNo: i + 1,
            productId: l.productId,
            presentationId: l.presentationId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            unitCostNet: null,
            discount: l.discount,
            taxGroupCode: cuenta?.taxGroupCode ?? null,
            taxAmount: cuenta?.taxAmount ?? CERO,
            lineTotal: cuenta?.lineTotal ?? CERO,
            lotCode: l.lotCode,
            expiresAt: l.expiresAt,
            description: l.description,
          };
        }),
      });
    } else if (opciones.materializarCosto === true) {
      // El confirm: el costo NETO por unidad deja de ser un derivado y se
      // congela — es el número que pisará `product_presentations.cost`.
      for (const [i, existente] of compra.lines.entries()) {
        const cuenta = resultado.lines[i];
        await tx.purchaseLine.update({
          where: { id: existente.id },
          data: {
            taxGroupCode: cuenta?.taxGroupCode ?? null,
            taxAmount: cuenta?.taxAmount ?? CERO,
            lineTotal: cuenta?.lineTotal ?? CERO,
            unitCostNet: costoNetoPorUnidad(
              cuenta?.lineTotal ?? CERO,
              cuenta?.taxAmount ?? CERO,
              existente.quantity,
            ),
          },
        });
      }
    }

    if (opciones.cargos !== undefined) {
      await tx.purchaseCharge.createMany({
        data: cargos.map((c, i) => {
          const cuenta = resultado.charges[i];
          return {
            tenantId,
            purchaseId,
            lineNo: i + 1,
            description: c.description,
            amount: c.amount,
            taxGroupId: c.grupo?.id ?? null,
            taxGroupCode: cuenta?.taxGroupCode ?? null,
            taxAmount: cuenta?.taxAmount ?? CERO,
            lineTotal: cuenta?.lineTotal ?? CERO,
          };
        }),
      });
    }

    await tx.purchaseTax.createMany({
      data: resultado.byComponent.map((c) => ({
        tenantId,
        purchaseId,
        code: c.code,
        name: c.name,
        rate: new Prisma.Decimal(c.rate),
        base: c.base,
        amount: c.amount,
        sortOrder: c.sortOrder,
      })),
    });

    await tx.purchase.update({
      where: { id: purchaseId },
      data: {
        subtotal: resultado.subtotal,
        discount: resultado.discount,
        taxTotal: resultado.taxTotal,
        total: resultado.total,
        extraChargesTotal: resultado.extraChargesTotal,
      },
    });
  }

  /** Los grupos del negocio por CÓDIGO: una línea guardada solo recuerda su código. */
  private gruposPorCodigo(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<Map<string, GrupoResuelto>> {
    return gruposPorCodigo(tx, tenantId);
  }

  /**
   * Resuelve productos y presentaciones: el producto tiene que ser del
   * negocio y la presentación, de ESE producto y activa. Una presentación
   * ajena no es un dato "a medio llenar": es imposible, y sin este guard la
   * FK la rechazaría con un 500 que no explica nada.
   */
  private async resolverLineas(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lineas: PurchaseLineDto[],
  ): Promise<LineaLista[]> {
    if (lineas.length === 0) {
      return [];
    }
    const productos = await tx.product.findMany({
      where: { tenantId, id: { in: [...new Set(lineas.map((l) => l.productId))] } },
      select: {
        id: true,
        name: true,
        presentations: { select: { id: true, name: true, isActive: true } },
      },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));
    // Las reglas de lote viven en `lot-rules.ts`, compartidas con la recepción.
    const lotes = await aplicarReglasDeLote(
      tx,
      tenantId,
      lineas.map((l) => ({
        productId: l.productId,
        lotCode: l.lotCode ?? null,
        expiresAt: l.expiresAt ?? null,
      })),
    );
    const fiscal = await contextoFiscal(
      tx,
      tenantId,
      lineas.map((l) => l.taxGroupId),
    );

    return lineas.map((linea, index) => {
      const producto = porId.get(linea.productId);
      if (producto === undefined) {
        throw new NotFoundException({ message: "purchases.product_not_found" });
      }
      let presentationId: string | null = null;
      if (linea.presentationId !== null && linea.presentationId !== undefined) {
        const presentacion = producto.presentations.find((p) => p.id === linea.presentationId);
        if (presentacion === undefined || !presentacion.isActive) {
          throw new UnprocessableEntityException({ message: "purchases.presentation_invalid" });
        }
        presentationId = presentacion.id;
      }
      const grupo =
        linea.taxGroupId === null
          ? null
          : linea.taxGroupId === undefined
            ? fiscal.porDefecto
            : (fiscal.grupos.get(linea.taxGroupId) ?? null);
      if (linea.taxGroupId != null && grupo === null) {
        throw new UnprocessableEntityException({ message: "catalogs.tax_group_unknown" });
      }
      return {
        productId: linea.productId,
        presentationId,
        quantity: linea.quantity == null ? null : new Prisma.Decimal(linea.quantity),
        unitCost: linea.unitCost == null ? null : new Prisma.Decimal(linea.unitCost),
        discount: new Prisma.Decimal(linea.discount ?? 0),
        grupo,
        lotCode: lotes[index]?.lotCode ?? null,
        expiresAt: lotes[index]?.expiresAt ?? null,
        description: producto.name,
      };
    });
  }

  private async resolverCargos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    cargos: PurchaseChargeDto[],
  ): Promise<CargoListo[]> {
    const fiscal = await contextoFiscal(
      tx,
      tenantId,
      cargos.map((c) => c.taxGroupId),
    );
    return cargos.map((cargo) => {
      const grupo =
        cargo.taxGroupId === null
          ? null
          : cargo.taxGroupId === undefined
            ? fiscal.porDefecto
            : (fiscal.grupos.get(cargo.taxGroupId) ?? null);
      if (cargo.taxGroupId != null && grupo === null) {
        throw new UnprocessableEntityException({ message: "catalogs.tax_group_unknown" });
      }
      return {
        description: cargo.description,
        amount: new Prisma.Decimal(cargo.amount),
        grupo,
      };
    });
  }

  private async detalle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<PurchaseDetail> {
    const compra = await this.purchases.buscar(tx, tenantId, id);
    const entry = await this.purchases.entradaViva(tx, tenantId, id);
    // `aDetalle` es privado en PurchasesService; el detalle público vuelve a
    // armarse acá con la misma forma a través del service dueño.
    return this.purchases.detailFrom(compra, entry);
  }
}

/**
 * Los grupos del negocio por CÓDIGO: una partida guardada solo recuerda su
 * código. Función de módulo (no método) para que Órdenes de compra la use sin
 * inyectar este service.
 */
export async function gruposPorCodigo(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<Map<string, GrupoResuelto>> {
  const grupos = await tx.taxGroup.findMany({
    where: { tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      rates: { select: { code: true, name: true, rate: true, sortOrder: true } },
    },
  });
  return new Map(
    grupos.map((g) => [
      g.code,
      {
        id: g.id,
        code: g.code,
        name: g.name,
        rates: [...g.rates]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((r) => ({ code: r.code, name: r.name, rate: r.rate.toString() })),
      },
    ]),
  );
}

/**
 * `armarCompra` resuelve el grupo por id contra un contexto; acá las partidas
 * ya traen el suyo resuelto (una línea guardada solo recuerda su CÓDIGO). Se
 * arma un contexto a medida donde cada id mapea a su grupo, que es la forma
 * de reusar el MISMO sumador sin duplicar su aritmética.
 */
export function armarCompraConGrupos(
  lineas: LineaLista[],
  cargos: CargoListo[],
  mode: "included" | "excluded",
) {
  const grupos = new Map<string, GrupoResuelto>();
  for (const partida of [...lineas, ...cargos]) {
    if (partida.grupo !== null) {
      grupos.set(partida.grupo.id, partida.grupo);
    }
  }
  return armarCompra({
    lines: lineas.map((l) => ({
      unitCost: l.unitCost ?? CERO,
      quantity: l.quantity ?? CERO,
      discount: l.discount,
      taxGroupId: l.grupo?.id ?? null,
    })),
    charges: cargos.map((c) => ({ amount: c.amount, taxGroupId: c.grupo?.id ?? null })),
    fiscal: { mode, porDefecto: null, grupos },
  });
}
