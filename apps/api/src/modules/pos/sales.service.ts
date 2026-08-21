import { ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { POS_FOLIO_PREFIXES } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { expandComposition } from "../inventory/composition-expander";
import { nextFolio } from "../inventory/folio";
import type { ResolvedLine } from "../inventory/line-resolver";
import { resolveLotsFefo } from "../inventory/lot-fefo";
import { StockLedgerService } from "../inventory/stock-ledger.service";
import { CashboxService } from "./cashbox.service";
import type { CreateSaleDto, SaleLineDto } from "./dto/create-sale.dto";

/** Lo que el catálogo dice que cuesta una línea. NUNCA lo que mandó el POST. */
interface PrecioResuelto {
  unitPrice: Prisma.Decimal;
  /** Cuánto vale en unidad BASE, ya multiplicado por el factor. */
  quantityBase: Prisma.Decimal;
  presentationId: string | null;
  sku: string;
}

/**
 * F4-SALE-01 — la transacción del cobro.
 *
 * ── La venta NO escribe stock ───────────────────────────────────────────
 *
 * Es LLAMADORA de `StockLedgerService.apply`, nunca escritora. Eso no es una
 * formalidad: significa que hereda de F3, sin una línea nueva, el `FOR UPDATE`
 * ordenado anti-deadlock, el reparto FEFO, la expansión de compuestos y el
 * bloqueo de lotes vencidos. El día que el ledger cambie una regla, la venta
 * cambia con él.
 *
 * ── Los precios los pone el SERVIDOR ────────────────────────────────────
 *
 * El carrito manda ids y cantidades. Si el precio viajara en el POST, alterarlo
 * sería cambiar lo que se cobra, y no habría forma de distinguir un descuento
 * legítimo de una manipulación. Se lee del catálogo y se COPIA a la línea:
 * un ticket de hace tres meses tiene que seguir diciendo lo que cobró.
 *
 * ── Una sola transacción ────────────────────────────────────────────────
 *
 * Folio, venta, líneas y movimientos van juntos. Si algo falla —stock que se
 * acabó entre que se armó el carrito y se cobró— no queda ni un folio gastado
 * ni media venta.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly cashbox: CashboxService,
  ) {}

  async create(user: AuthUser, dto: CreateSaleDto) {
    const sesion = await this.cashbox.current(user);
    if (sesion === null) {
      // Antes de abrir la transacción: sin turno no hay almacén del que
      // descontar, así que no hay nada que intentar.
      throw new ConflictException({ message: "pos.no_session" });
    }

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const precios = await this.resolverPrecios(tx, user, dto.lines);

      const subtotal = dto.lines.reduce(
        (acc, line, i) =>
          acc.plus(
            (precios[i] as PrecioResuelto).unitPrice.times(new Prisma.Decimal(line.quantity)),
          ),
        new Prisma.Decimal(0),
      );
      const descuento = dto.lines.reduce(
        (acc, line) => acc.plus(new Prisma.Decimal(line.discount ?? 0)),
        new Prisma.Decimal(0),
      );
      if (descuento.greaterThan(subtotal)) {
        throw new UnprocessableEntityException({ message: "pos.discount_exceeds_subtotal" });
      }

      const folio = await nextFolio(tx, user.tenantId, "sale", POS_FOLIO_PREFIXES.sale);

      const venta = await tx.sale.create({
        data: {
          tenantId: user.tenantId,
          folio,
          warehouseId: sesion.warehouseId,
          cashboxSessionId: sesion.id,
          ...(dto.quoteId !== undefined && { quoteId: dto.quoteId }),
          paymentMethod: dto.paymentMethod,
          subtotal,
          discount: descuento,
          total: subtotal.minus(descuento),
          createdBy: user.userId,
          items: {
            create: dto.lines.map((line, i) => {
              const precio = precios[i] as PrecioResuelto;
              const cantidad = new Prisma.Decimal(line.quantity);
              const desc = new Prisma.Decimal(line.discount ?? 0);
              return {
                tenantId: user.tenantId,
                lineNo: i + 1,
                ...(line.productId !== undefined && { productId: line.productId }),
                ...(line.serviceId !== undefined && { serviceId: line.serviceId }),
                presentationId: precio.presentationId,
                quantity: cantidad,
                unitPrice: precio.unitPrice,
                discount: desc,
                lineTotal: precio.unitPrice.times(cantidad).minus(desc),
              };
            }),
          },
        },
      });

      // ── El stock: SOLO las líneas de producto ──────────────────────────
      //
      // Un SERVICIO no tiene existencias — no aparece en entradas, salidas,
      // conteos ni kardex (F3-SVC). Que no pase por acá es la forma de
      // decirlo: no hay un `if` que lo salte, simplemente no está en la lista.
      const deProducto: ResolvedLine[] = dto.lines
        .map((line, i) => ({ line, precio: precios[i] as PrecioResuelto, i }))
        .filter((x) => x.line.productId !== undefined)
        .map(({ line, precio, i }) => ({
          lineIndex: i,
          productId: line.productId as string,
          sku: precio.sku,
          presentationId: precio.presentationId,
          quantityBase: precio.quantityBase,
          quantityInput: new Prisma.Decimal(line.quantity),
          unitCost: null,
          expand: false,
        }));

      if (deProducto.length > 0) {
        // El MISMO camino que una salida de F3: expandir compuestos, repartir
        // FEFO —que ya se niega a tomar lotes vencidos para `sale`— y asentar.
        const expandidas = await expandComposition(tx, user.tenantId, deProducto);
        const conLotes = await resolveLotsFefo(
          tx,
          user.tenantId,
          sesion.warehouseId,
          expandidas,
          "sale",
        );

        await this.ledger.apply(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          direction: "exit",
          reasonCode: "sale",
          warehouseId: sesion.warehouseId,
          lines: conLotes,
          header: { saleId: venta.id, reference: folio },
        });
      }

      return tx.sale.findUniqueOrThrow({
        where: { id: venta.id },
        include: { items: { orderBy: { lineNo: "asc" } } },
      });
    });
  }

  /**
   * Los precios, del CATÁLOGO.
   *
   * Un producto se cobra por su PRESENTACIÓN: la elegida, o la de factor 1 si
   * el carrito no mandó ninguna. El `factor` es también lo que convierte la
   * cantidad a unidad base — vender "2 cajas ×12" descuenta 24, no 2.
   */
  private async resolverPrecios(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    lines: SaleLineDto[],
  ): Promise<PrecioResuelto[]> {
    const resueltos: PrecioResuelto[] = [];

    for (const [i, line] of lines.entries()) {
      if (line.serviceId !== undefined) {
        const servicio = await tx.service.findFirst({
          where: { id: line.serviceId, tenantId: user.tenantId, isActive: true },
          select: { code: true, price: true },
        });
        if (servicio === null) {
          throw new UnprocessableEntityException({
            message: "pos.service_not_sellable",
            args: { lineIndex: i },
          });
        }
        resueltos.push({
          unitPrice: servicio.price ?? new Prisma.Decimal(0),
          quantityBase: new Prisma.Decimal(line.quantity),
          presentationId: null,
          sku: servicio.code,
        });
        continue;
      }

      const producto = await tx.product.findFirst({
        where: { id: line.productId, tenantId: user.tenantId, isActive: true },
        select: {
          sku: true,
          presentations: {
            where: { isActive: true, isSellable: true },
            select: { id: true, factor: true, price: true, isDefaultSale: true },
            orderBy: { factor: "asc" },
          },
        },
      });
      if (producto === null) {
        throw new UnprocessableEntityException({
          message: "pos.product_not_sellable",
          args: { lineIndex: i },
        });
      }

      const presentacion =
        line.presentationId !== undefined
          ? producto.presentations.find((p) => p.id === line.presentationId)
          : (producto.presentations.find((p) => p.isDefaultSale) ?? producto.presentations[0]);

      if (presentacion === undefined) {
        throw new UnprocessableEntityException({
          message: "pos.presentation_not_sellable",
          args: { sku: producto.sku, lineIndex: i },
        });
      }

      resueltos.push({
        unitPrice: presentacion.price ?? new Prisma.Decimal(0),
        quantityBase: new Prisma.Decimal(line.quantity).times(presentacion.factor),
        presentationId: presentacion.id,
        sku: producto.sku,
      });
    }

    return resueltos;
  }
}
