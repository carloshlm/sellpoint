import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  endOfDayUtc,
  POS_FOLIO_PREFIXES,
  type PosLineKind,
  startOfDayUtc,
} from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { EntitlementsService } from "../billing/entitlements.service";
import { nextFolio } from "../inventory/folio";
import {
  assertActiveWarehouse,
  assertWarehouseInScope,
} from "../inventory/warehouse-scope.helpers";
import { CashboxService } from "./cashbox.service";
import type {
  CancelQuoteDto,
  CreateQuoteDto,
  ListQuotesQuery,
  QuoteLineDto,
} from "./dto/quote.dto";
import { conDisponibilidad, type LookupItem, SELECT_PRODUCTO } from "./lookup.strategies";
import { allowNegativeStock } from "./stock-policy";
import { sellableStock } from "./warehouse-availability";

/**
 * Lo que el catálogo dice de una línea. NUNCA lo que mandó el POST — con una
 * excepción a la vista: el CONCEPTO no tiene catálogo, así que su precio es
 * el que se cotizó (F4-CONCEPT-04). Es la única línea con precio congelado.
 */
export interface LineaResuelta {
  kind: PosLineKind;
  unitPrice: Prisma.Decimal;
  presentationId: string | null;
  /** Lo que se cotizó, en texto: sobrevive a que el producto cambie de nombre. */
  description: string;
  productId: string | null;
  serviceId: string | null;
  /** En unidad BASE, para chequear disponibilidad. */
  quantityBase: Prisma.Decimal;
}

/**
 * F4-QUOTE-01 — la cotización.
 *
 * ── Qué es y qué NO es ──────────────────────────────────────────────────
 *
 * Es **una lista con folio**, no una operación. No escribe un solo
 * `stock_movement`, no reserva nada y no exige turno de caja: cotizar es
 * responder "¿cuánto me sale?", y eso pasa en el mostrador, por teléfono o
 * caminando por el pasillo. Exigir caja abierta para contestar una pregunta
 * sería burocracia pura.
 *
 * De ahí salen sus tres diferencias con la venta:
 *
 *  · **`pos:quote`, no `pos:sell`** — quien cotiza no necesariamente cobra;
 *  · **sin turno** — el almacén sale del asignado del cotizador, no de la caja;
 *  · **precios de REFERENCIA** — no se congelan. Al cargarla en el POS se
 *    releen del catálogo vigente (F4-QUOTE-02), porque un papel de hace un mes
 *    no puede obligar al negocio a un precio que ya no existe.
 *
 * ── Lo vencido tampoco se cotiza ────────────────────────────────────────
 *
 * "No puedes vender un producto vencido, y por ahora solo se bloquea para
 * venta y cotización" (Carlos, 2026-08-20). La VENTA lo hereda del ledger:
 * FEFO se niega a tomar un lote caducado. **La cotización no pasa por ahí**
 * —no genera movimiento, así que no tiene `reason_code`— y por eso su bloqueo
 * vive acá, sobre la misma `sellableStock` que alimenta al buscador. Es el
 * único lado de la regla que F3 no pudo cerrar.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbox: CashboxService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(user: AuthUser, scope: UserScope, dto: CreateQuoteDto) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const warehouseId = dto.warehouseId ?? (await this.almacenDelCotizador(tx, user));
      assertWarehouseInScope(scope, warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, warehouseId);

      const lineas = await this.resolverLineas(tx, user, warehouseId, dto.lines);

      const total = lineas.reduce(
        (acc, l, i) => acc.plus(l.unitPrice.times(new Prisma.Decimal(dto.lines[i]?.quantity ?? 0))),
        new Prisma.Decimal(0),
      );

      // El folio se toma DENTRO de la transacción, igual que en la venta. Es
      // corta —no hay ledger que asentar— así que el lock de la serie dura
      // milisegundos.
      const folio = await nextFolio(tx, user.tenantId, "quote", POS_FOLIO_PREFIXES.quote);

      const cotizacion = await tx.quote.create({
        data: {
          tenantId: user.tenantId,
          folio,
          warehouseId,
          total,
          ...(dto.note !== undefined && { note: dto.note }),
          createdBy: user.userId,
          lines: {
            create: lineas.map((l, i) => {
              const cantidad = new Prisma.Decimal(dto.lines[i]?.quantity ?? 0);
              return {
                tenantId: user.tenantId,
                lineNo: i + 1,
                kind: l.kind,
                ...(l.productId !== null && { productId: l.productId }),
                ...(l.serviceId !== null && { serviceId: l.serviceId }),
                presentationId: l.presentationId,
                description: l.description,
                quantity: cantidad,
                unitPrice: l.unitPrice,
                lineTotal: l.unitPrice.times(cantidad),
              };
            }),
          },
        },
      });

      return tx.quote.findUniqueOrThrow({
        where: { id: cotizacion.id },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
    });
  }

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

  async list(user: AuthUser, query: ListQuotesQuery) {
    const zona = await this.zonaDelNegocio(user.tenantId);
    const where = {
      tenantId: user.tenantId,
      ...(query.status !== undefined && { status: query.status }),
      // `contains` y no `equals`: el cliente dicta "cero cero uno" por
      // teléfono y nadie teclea el prefijo completo.
      ...(query.folio !== undefined && {
        folio: { contains: query.folio, mode: "insensitive" as const },
      }),
      // El rango son DÍAS del calendario del negocio, mismo contrato que
      // ventas, kardex y documentos. `lt` y no `lte`: el fin de día es el
      // ARRANQUE del siguiente, así no se pierde el último milisegundo.
      ...((query.from !== undefined || query.to !== undefined) && {
        createdAt: {
          ...(query.from !== undefined && { gte: startOfDayUtc(query.from, zona) }),
          ...(query.to !== undefined && { lt: endOfDayUtc(query.to, zona) }),
        },
      }),
    };

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.quote.count({ where }),
        tx.quote.findMany({
          where,
          // Desempate por `id`: sin él, dos cotizaciones del mismo instante
          // quedan en un orden que Postgres decide y que cambia entre
          // consultas — una fila podría salir en dos páginas o en ninguna.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            lines: { orderBy: { lineNo: "asc" } },
            warehouse: { select: { id: true, name: true } },
            author: { select: { id: true, firstName: true, lastNamePaternal: true } },
          },
        }),
      ]);

      return {
        rows: rows.map((q) => ({
          ...q,
          author: {
            id: q.author.id,
            name: `${q.author.firstName} ${q.author.lastNamePaternal}`.trim(),
          },
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async detail(user: AuthUser, id: string) {
    const cotizacion = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.quote.findFirst({
        where: { id, tenantId: user.tenantId },
        include: {
          lines: { orderBy: { lineNo: "asc" } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
    );
    if (cotizacion === null) {
      // 404 y no 403: una cotización de otro tenant no es "prohibida", NO
      // EXISTE para este. Distinguirlas filtraría información por el código.
      throw new NotFoundException({ message: "pos.quote_not_found" });
    }
    return cotizacion;
  }

  /**
   * Cancelar.
   *
   * El lock es LÓGICO y va primero (`updateMany … WHERE status='open'` con
   * `count = 1`): leer el estado y después actualizar deja una ventana donde
   * una cancelación pisaría una carga que ya ocurrió. Mismo patrón que
   * `markConfirmed` en F3 y que la anulación de venta.
   *
   * Una `loaded` **no se cancela**: ya se convirtió en una venta, y lo que hay
   * que deshacer es esa venta, no el papel que la originó.
   */
  async cancel(user: AuthUser, id: string, dto: CancelQuoteDto) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const cotizacion = await tx.quote.findFirst({ where: { id, tenantId: user.tenantId } });
      if (cotizacion === null) {
        throw new NotFoundException({ message: "pos.quote_not_found" });
      }

      const tomadas = await tx.quote.updateMany({
        where: { id, tenantId: user.tenantId, status: "open" },
        data: {
          status: "canceled",
          canceledBy: user.userId,
          // `canceled_at` no es decorado: el CHECK `quotes_status_coherent`
          // exige que cada estado traiga SU marca de tiempo y ninguna de las
          // otras. Un `canceled` sin cuándo es un dato que no se explica.
          canceledAt: new Date(),
          ...(dto.reason !== undefined && { note: dto.reason }),
        },
      });
      if (tomadas.count !== 1) {
        throw new ConflictException({ message: "pos.quote_not_open" });
      }

      return tx.quote.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
    });
  }

  /**
   * F4-QUOTE-02 — la cotización lista para cobrar.
   *
   * ── Los precios se RELEEN, no se copian ─────────────────────────────────
   *
   * Decisión de Carlos: la cotización no congela precios. Un papel de hace un
   * mes no puede obligar al negocio a un precio que ya no existe, y tampoco
   * puede cobrarle de más al cliente si el precio bajó. Se devuelve el precio
   * de HOY junto al que decía el papel, para que quien atiende pueda explicar
   * la diferencia en vez de descubrirla en la caja.
   *
   * ── Los faltantes se MARCAN, no se esconden ─────────────────────────────
   *
   * La disponibilidad se resuelve contra el almacén del TURNO, que puede no ser
   * el de la cotización — se cotiza en la sucursal y se cobra en la central.
   * Devolver la lista sin las líneas que no alcanzan sería más "limpio" y
   * dejaría al cajero preguntándose por qué el total no cuadra con el papel.
   */
  async forSale(user: AuthUser, folio: string) {
    const sesion = await this.cashbox.current(user);
    if (sesion === null) {
      throw new ConflictException({ message: "pos.no_session" });
    }

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const cotizacion = await tx.quote.findFirst({
        where: { tenantId: user.tenantId, folio: folio.trim().toUpperCase() },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
      if (cotizacion === null) {
        throw new NotFoundException({ message: "pos.quote_not_found" });
      }
      if (cotizacion.status !== "open") {
        // Una `loaded` ya se cobró y una `canceled` se dio de baja. El 409 dice
        // "existe pero no se puede", que es distinto del 404 y es justo lo que
        // quien tiene el papel en la mano necesita saber.
        throw new ConflictException({ message: "pos.quote_not_open" });
      }

      const productIds = cotizacion.lines
        .map((l) => l.productId)
        .filter((id): id is string => id !== null);
      const stock = await sellableStock(tx, user.tenantId, sesion.warehouseId, productIds);

      // ── Los items, en el MISMO contrato que el buscador ───────────────
      //
      // El carrito ya sabe consumir un `LookupItem` (F4-CART-02). Devolver eso
      // en vez de una forma propia hace que volcar la cotización sea un
      // `add()` por línea, sin traducción — y sin una segunda estructura que
      // un día diverja de la que el carrito espera.
      const productos =
        productIds.length === 0
          ? []
          : await tx.product.findMany({
              where: { id: { in: productIds }, tenantId: user.tenantId, isActive: true },
              select: SELECT_PRODUCTO,
            });
      // La MISMA regla que el buscador y el cobro (`stock-policy.ts`): con
      // «Vender sin existencias», una línea en cero no se marca como no
      // disponible — la caja la va a cobrar igual.
      const allowNegative = await allowNegativeStock(this.entitlements, this.prisma, user.tenantId);
      const items = await conDisponibilidad(
        { tx, tenantId: user.tenantId, warehouseId: sesion.warehouseId, allowNegative },
        productos,
        "quote",
      );
      const itemPorProducto = new Map(items.map((i) => [i.id, i]));

      const servicios =
        cotizacion.lines.filter((l) => l.serviceId !== null).length === 0
          ? []
          : await tx.service.findMany({
              where: {
                id: {
                  in: cotizacion.lines
                    .map((l) => l.serviceId)
                    .filter((id): id is string => id !== null),
                },
                tenantId: user.tenantId,
                isActive: true,
                // El servicio tiene que ofrecerse en el almacén del TURNO: uno
                // cotizado en la sucursal puede no existir en la central.
                warehouses: { some: { warehouseId: sesion.warehouseId } },
              },
              select: { id: true, code: true, name: true, price: true },
            });
      const servicioPorId = new Map(servicios.map((s) => [s.id, s]));

      const lineas = await Promise.all(
        cotizacion.lines.map(async (linea) => {
          const vigente = await this.precioVigente(tx, user, linea);
          const disponible = linea.productId === null ? null : stock.get(linea.productId);

          // La cantidad en unidad BASE: dos cajas ×12 son 24 piezas.
          const factor =
            linea.presentationId === null
              ? new Prisma.Decimal(1)
              : ((
                  await tx.productPresentation.findFirst({
                    where: { id: linea.presentationId, tenantId: user.tenantId },
                    select: { factor: true },
                  })
                )?.factor ?? new Prisma.Decimal(1));
          const pedidoBase = linea.quantity.times(factor);

          const servicio = linea.serviceId === null ? null : servicioPorId.get(linea.serviceId);
          const item: LookupItem | null =
            linea.productId !== null
              ? (itemPorProducto.get(linea.productId) ?? null)
              : servicio === undefined || servicio === null
                ? null
                : {
                    type: "service" as const,
                    matchedBy: "quote" as const,
                    id: servicio.id,
                    code: servicio.code,
                    name: servicio.name,
                    price: servicio.price?.toString() ?? null,
                  };

          return {
            lineNo: linea.lineNo,
            productId: linea.productId,
            serviceId: linea.serviceId,
            presentationId: linea.presentationId,
            description: linea.description,
            quantity: linea.quantity.toString(),
            /** Lo que decía el PAPEL. Se devuelve para poder explicar la diferencia. */
            quotedUnitPrice: linea.unitPrice.toString(),
            /** Lo que cuesta HOY. Es lo que se va a cobrar. */
            unitPrice: vigente === null ? null : vigente.toString(),
            /**
             * `true` cuando la línea ya no se puede vender desde este almacén:
             * el ítem salió del catálogo, el servicio no se ofrece acá, o no
             * alcanza el stock. Se marca, no se esconde.
             */
            unavailable: vigente === null || item === null,
            /**
             * Lo que el carrito necesita para armar la línea, en su propio
             * contrato. `null` cuando el ítem ya no se puede vender desde este
             * almacén — se marca, no se esconde.
             */
            item,
            shortfall:
              disponible === undefined || disponible === null
                ? null
                : pedidoBase.greaterThan(disponible.available)
                  ? pedidoBase.minus(disponible.available).toString()
                  : null,
          };
        }),
      );

      return {
        id: cotizacion.id,
        folio: cotizacion.folio,
        status: cotizacion.status,
        warehouseId: sesion.warehouseId,
        note: cotizacion.note,
        /** El total del PAPEL. El de hoy lo arma el carrito con los precios nuevos. */
        quotedTotal: cotizacion.total.toString(),
        lines: lineas,
      };
    });
  }

  /**
   * El almacén del cotizador (F3-HOME).
   *
   * Si no tiene asignado, el cliente debe mandar `warehouseId` explícito:
   * adivinar "el primero del tenant" cotizaría precios y disponibilidad de una
   * sucursal que nadie eligió.
   */
  private async almacenDelCotizador(tx: Prisma.TransactionClient, user: AuthUser): Promise<string> {
    const fila = await tx.user.findFirst({
      where: { id: user.userId, tenantId: user.tenantId },
      select: { defaultWarehouseId: true },
    });
    if (fila?.defaultWarehouseId == null) {
      throw new NotFoundException({ message: "pos.no_default_warehouse" });
    }
    return fila.defaultWarehouseId;
  }

  /** El precio de HOY de una línea ya guardada, o `null` si ya no se vende. */
  private async precioVigente(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    linea: { productId: string | null; serviceId: string | null; presentationId: string | null },
  ): Promise<Prisma.Decimal | null> {
    if (linea.serviceId !== null) {
      const servicio = await tx.service.findFirst({
        where: { id: linea.serviceId, tenantId: user.tenantId, isActive: true },
        select: { price: true },
      });
      return servicio === null ? null : (servicio.price ?? new Prisma.Decimal(0));
    }

    const presentacion = await tx.productPresentation.findFirst({
      where: {
        id: linea.presentationId ?? undefined,
        tenantId: user.tenantId,
        isActive: true,
        isSellable: true,
        product: { isActive: true },
      },
      select: { price: true },
    });
    return presentacion === null ? null : (presentacion.price ?? new Prisma.Decimal(0));
  }

  /**
   * Los precios, del CATÁLOGO — y la disponibilidad, del almacén.
   *
   * Un producto cuyo único stock está VENCIDO no se cotiza: `sellableStock` ya
   * descuenta lo caducado, así que la misma consulta que alimenta al buscador
   * cierra la regla acá sin duplicar el criterio.
   */
  private resolverLineas(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    warehouseId: string,
    lines: QuoteLineDto[],
  ): Promise<LineaResuelta[]> {
    return this.resolverLineasParaModulo(tx, user, warehouseId, lines);
  }

  /**
   * La MISMA resolución, expuesta para los módulos que cotizan por dentro
   * (la orden médica de F9-CLINIC crea su cotización dentro de su propia
   * transacción). Duplicarla significaría que el día que el POS bloquee
   * algo —un lote vencido, una presentación no vendible— la receta seguiría
   * cotizando lo que la caja va a rechazar.
   */
  async resolverLineasParaModulo(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    warehouseId: string,
    lines: QuoteLineDto[],
  ): Promise<LineaResuelta[]> {
    const productIds = lines.map((l) => l.productId).filter((id): id is string => id !== undefined);
    const stock = await sellableStock(tx, user.tenantId, warehouseId, productIds);

    const resueltas: LineaResuelta[] = [];

    for (const [i, line] of lines.entries()) {
      if (line.concept !== undefined) {
        // El concepto no consulta stock ni catálogo: su precio es el que se
        // cotizó, y eso es justamente lo que permite que la venta lo copie
        // de acá y nunca del cliente (F4-CONCEPT-06).
        resueltas.push({
          kind: "concept",
          unitPrice: new Prisma.Decimal(line.concept.unitPrice),
          presentationId: null,
          description: line.concept.description,
          productId: null,
          serviceId: null,
          quantityBase: new Prisma.Decimal(line.quantity),
        });
        continue;
      }

      if (line.serviceId !== undefined) {
        const servicio = await tx.service.findFirst({
          where: {
            id: line.serviceId,
            tenantId: user.tenantId,
            isActive: true,
            // El servicio tiene que ofrecerse en ESE almacén: cotizar uno que
            // ahí no existe es prometer algo que no se puede cumplir.
            warehouses: { some: { warehouseId } },
          },
          select: { code: true, name: true, price: true },
        });
        if (servicio === null) {
          throw new UnprocessableEntityException({
            message: "pos.service_not_sellable",
            args: { lineIndex: i },
          });
        }
        resueltas.push({
          kind: "service",
          unitPrice: servicio.price ?? new Prisma.Decimal(0),
          presentationId: null,
          description: servicio.name,
          productId: null,
          serviceId: line.serviceId,
          quantityBase: new Prisma.Decimal(line.quantity),
        });
        continue;
      }

      const producto = await tx.product.findFirst({
        where: { id: line.productId, tenantId: user.tenantId, isActive: true },
        select: {
          id: true,
          sku: true,
          name: true,
          presentations: {
            where: { isActive: true, isSellable: true },
            select: { id: true, name: true, factor: true, price: true, isDefaultSale: true },
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

      // ⚠ LA REGLA DE CARLOS. Lo vencido no se vende NI se cotiza. Se compara
      // contra `available`, que ya descuenta los lotes caducados: un producto
      // con doce cajas en el anaquel, todas vencidas, da cero acá.
      const disponible = stock.get(producto.id)?.available ?? new Prisma.Decimal(0);
      if (disponible.lessThanOrEqualTo(0)) {
        throw new UnprocessableEntityException({
          message: "pos.product_not_available",
          args: { sku: producto.sku, lineIndex: i },
          // El renglón culpable como DATO, mismo criterio que el ledger.
          sku: producto.sku,
        });
      }

      resueltas.push({
        kind: "product",
        unitPrice: presentacion.price ?? new Prisma.Decimal(0),
        presentationId: presentacion.id,
        // El texto sobrevive a que el producto cambie de nombre: el papel que
        // el cliente se llevó decía ESTO.
        description: `${producto.name} — ${presentacion.name}`,
        productId: producto.id,
        serviceId: null,
        quantityBase: new Prisma.Decimal(line.quantity).times(presentacion.factor),
      });
    }

    return resueltas;
  }
}
