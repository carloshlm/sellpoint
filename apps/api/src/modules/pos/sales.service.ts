import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { endOfDayUtc, POS_FOLIO_PREFIXES, startOfDayUtc } from "@sellpoint/shared";
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
import type { CancelSaleDto, ListSalesQuery } from "./dto/list-sales.dto";

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

  /**
   * ── La idempotencia, y por qué se resuelve ANTES de la transacción ──────
   *
   * Se busca primero: el 99% de los reintentos llegan cuando la primera venta
   * YA terminó, así que devolverla sin abrir transacción ni tomar locks es lo
   * barato y lo correcto. Lo que esa búsqueda NO cubre es la carrera —dos
   * toques casi simultáneos, ninguno terminado— y por eso NO se confía en
   * ella: abajo, el UNIQUE parcial de la base atrapa al segundo y ahí se
   * vuelve a leer. Chequeo optimista arriba, garantía de la base abajo.
   */
  async create(user: AuthUser, dto: CreateSaleDto, idempotencyKey?: string) {
    if (idempotencyKey !== undefined) {
      const previa = await this.buscarPorClave(user, idempotencyKey);
      if (previa !== null) {
        return previa;
      }
    }

    return this.crearVenta(user, dto, idempotencyKey);
  }

  private async buscarPorClave(user: AuthUser, idempotencyKey: string) {
    return this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.sale.findFirst({
        where: { tenantId: user.tenantId, idempotencyKey },
        include: { items: { orderBy: { lineNo: "asc" } } },
      }),
    );
  }

  private async crearVenta(user: AuthUser, dto: CreateSaleDto, idempotencyKey?: string) {
    const sesion = await this.cashbox.current(user);
    if (sesion === null) {
      // Antes de abrir la transacción: sin turno no hay almacén del que
      // descontar, así que no hay nada que intentar.
      throw new ConflictException({ message: "pos.no_session" });
    }

    return this.prisma
      .withTenantContext(user.tenantId, async (tx) => {
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

        // ── F4-QUOTE-02: la cotización se marca CARGADA ────────────────────
        //
        // **Va ANTES del `create`, y eso importa.** `sales.quote_id` es UNIQUE,
        // así que un segundo cobro del mismo folio también rebotaría — pero con
        // un P2002 crudo que sale como 500 y no dice nada. Chequear primero
        // convierte esa colisión en un 409 con mensaje. (Lo cazó el e2e "una
        // cotización ya cargada no se cobra de nuevo".)
        //
        // `updateMany … WHERE status='open'` con `count = 1` y no un `update` a
        // secas: dos cajeros con el mismo papel en la mano llegan los dos hasta
        // acá, y el lock de fila los ordena — el segundo encuentra `loaded` y
        // no toma nada.
        //
        // `loadedAt` no es decorado: el CHECK `quotes_status_coherent` exige
        // que cada estado traiga SU marca de tiempo. Un `loaded` sin cuándo es
        // una cotización usada que nadie puede rastrear.
        if (dto.quoteId !== undefined) {
          const cargadas = await tx.quote.updateMany({
            where: { id: dto.quoteId, tenantId: user.tenantId, status: "open" },
            data: { status: "loaded", loadedAt: new Date() },
          });
          if (cargadas.count !== 1) {
            throw new ConflictException({ message: "pos.quote_not_open" });
          }
        }

        const folio = await nextFolio(tx, user.tenantId, "sale", POS_FOLIO_PREFIXES.sale);

        const venta = await tx.sale.create({
          data: {
            tenantId: user.tenantId,
            folio,
            warehouseId: sesion.warehouseId,
            cashboxSessionId: sesion.id,
            ...(dto.quoteId !== undefined && { quoteId: dto.quoteId }),
            ...(idempotencyKey !== undefined && { idempotencyKey }),
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
      })
      .catch(async (error) => {
        // La CARRERA: dos toques casi simultáneos, ninguno terminado cuando el
        // otro consultó. El UNIQUE parcial `(tenant_id, idempotency_key)` deja
        // pasar a uno solo; el segundo llega acá con su transacción ya deshecha
        // —sin folio gastado, sin stock movido— y se lleva la venta del primero.
        //
        // Esto es lo que hace que la idempotencia sea REAL y no una comodidad:
        // sin el UNIQUE, dos taps rápidos cobran dos veces por más `findFirst`
        // que se ponga arriba.
        if (
          idempotencyKey !== undefined &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const ganadora = await this.buscarPorClave(user, idempotencyKey);
          if (ganadora !== null) {
            return ganadora;
          }
        }
        throw error;
      });
  }

  /**
   * F4-SALE-04 — el historial.
   *
   * Las anuladas **se ven marcadas, no desaparecen**. Esconderlas por defecto
   * sería tentador —"ruido"— y sería justo lo contrario de lo que necesita
   * quien busca una venta que no cuadra: encontrarla precisamente cuando está
   * anulada.
   */
  /**
   * La zona horaria del negocio, para traducir días del calendario a
   * instantes. Una fila por clave primaria: lo más barato que hace Postgres.
   * No se cachea a propósito — un valor viejo daría un rango equivocado justo
   * cuando el tenant cambia de zona, y en silencio.
   */
  private async zonaDelNegocio(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? "UTC";
  }

  async list(user: AuthUser, query: ListSalesQuery) {
    const zona = await this.zonaDelNegocio(user.tenantId);
    const where = {
      tenantId: user.tenantId,
      ...(query.folio !== undefined && {
        folio: { contains: query.folio, mode: "insensitive" as const },
      }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.sellerId !== undefined && { createdBy: query.sellerId }),
      ...(query.sessionId !== undefined && { cashboxSessionId: query.sessionId }),
      ...(query.from !== undefined || query.to !== undefined
        ? {
            createdAt: {
              ...(query.from !== undefined && { gte: startOfDayUtc(query.from, zona) }),
              // `lt` y no `lte`: el fin de día es el ARRANQUE del siguiente,
              // así no se pierde el último milisegundo.
              ...(query.to !== undefined && { lt: endOfDayUtc(query.to, zona) }),
            },
          }
        : {}),
    };

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.sale.count({ where }),
        tx.sale.findMany({
          where,
          // Desempate por `id`: sin él, dos ventas del MISMO instante quedan en
          // un orden que Postgres decide y que cambia entre consultas — una
          // fila podría salir en dos páginas o en ninguna. Mismo criterio que
          // el listado de traspasos.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            items: { orderBy: { lineNo: "asc" } },
            warehouse: { select: { id: true, name: true } },
            seller: { select: { id: true, firstName: true, lastNamePaternal: true } },
          },
        }),
      ]);

      return {
        rows: rows.map((sale) => ({
          ...sale,
          seller: {
            id: sale.seller.id,
            name: `${sale.seller.firstName} ${sale.seller.lastNamePaternal}`.trim(),
          },
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async detail(user: AuthUser, id: string) {
    const venta = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.sale.findFirst({
        where: { id, tenantId: user.tenantId },
        include: {
          items: { orderBy: { lineNo: "asc" } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
    );
    if (venta === null) {
      // 404 y no 403: una venta de otro tenant no es "prohibida", NO EXISTE
      // para este. Distinguirlas filtraría información por el código de error.
      throw new NotFoundException({ message: "pos.sale_not_found" });
    }
    return venta;
  }

  /**
   * F4-SALE-03 — anular.
   *
   * **No borra: revierte.** El sistema es append-only, así que deshacer una
   * venta es asentar su contrario con motivo `sale_return` — el kardex muestra
   * la salida y su reverso, y quien audita ve qué pasó. Borrar la venta
   * dejaría el saldo correcto y la historia muda.
   *
   * El lock es LÓGICO y va primero: `updateMany … WHERE status='completed'`
   * con `count = 1`. Leer el estado y después actualizar deja una ventana
   * donde dos anulaciones simultáneas devolverían el stock DOS veces — el
   * mismo patrón de `markConfirmed` en F3.
   */
  async cancel(user: AuthUser, id: string, dto: CancelSaleDto) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const venta = await tx.sale.findFirst({
        where: { id, tenantId: user.tenantId },
        include: { items: true },
      });
      if (venta === null) {
        throw new NotFoundException({ message: "pos.sale_not_found" });
      }

      const tomadas = await tx.sale.updateMany({
        where: { id, tenantId: user.tenantId, status: "completed" },
        data: {
          status: "canceled",
          canceledBy: user.userId,
          canceledAt: new Date(),
          cancelReason: dto.reason,
        },
      });
      if (tomadas.count !== 1) {
        throw new ConflictException({ message: "pos.sale_already_canceled" });
      }

      // El reverso sale de los MOVIMIENTOS asentados, no de las líneas de la
      // venta. Es la diferencia que importa: una línea de compuesto se expandió
      // en componentes y una con lotes se repartió por FEFO, así que devolver
      // "lo que decía la línea" dejaría el stock en otro lado del que salió.
      // Los movimientos son lo que REALMENTE pasó.
      const movimientos = await tx.stockMovement.findMany({
        where: { saleId: id, tenantId: user.tenantId },
        select: {
          productId: true,
          presentationId: true,
          quantity: true,
          lotId: true,
          location: true,
          parentProductId: true,
          product: { select: { sku: true } },
        },
      });

      if (movimientos.length > 0) {
        await this.ledger.apply(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          direction: "entry",
          reasonCode: "sale_return",
          warehouseId: venta.warehouseId,
          lines: movimientos.map((m, index) => ({
            lineIndex: index,
            productId: m.productId,
            sku: m.product.sku,
            presentationId: m.presentationId,
            quantityBase: m.quantity,
            quantityInput: m.quantity,
            unitCost: null,
            expand: false,
            ...(m.lotId !== null && { lotId: m.lotId }),
            ...(m.location !== null && { location: m.location }),
            ...(m.parentProductId !== null && { parentProductId: m.parentProductId }),
          })),
          header: { saleId: id, reference: venta.folio, reasonNote: dto.reason },
        });
      }

      return tx.sale.findUniqueOrThrow({
        where: { id },
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
