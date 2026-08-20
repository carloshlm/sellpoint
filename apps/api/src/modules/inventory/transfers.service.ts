import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { FOLIO_PREFIXES, TRANSFER_STALE_DAYS } from "@sellpoint/shared";
import type { TransferStatus } from "../../generated/prisma/client";
// `Prisma` va como VALOR y no como `import type`: `Prisma.Decimal` es un
// constructor que se USA en runtime, no solo un espacio de tipos. Con
// `import type` compila igual y revienta en producción con
// "ReferenceError: Prisma is not defined".
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { nextFolio } from "./folio";
import { assertActiveWarehouse, assertWarehouseInScope } from "./warehouse-scope.helpers";

export interface ListTransfersOptions {
  status?: TransferStatus;
  direction?: "incoming" | "outgoing";
  originWarehouseId?: string;
  destinationWarehouseId?: string;
  from?: Date;
  to?: Date;
  olderThanDays?: number;
  page?: number;
  pageSize?: number;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * F3-TRANSFER-01 — el listado de traspasos.
 *
 * **La pregunta que resuelve es de responsabilidad**, no de datos: qué salió
 * de mi almacén y todavía no llegó, y qué viene hacia mí y no confirmé. Por eso
 * `direction` no es un filtro cosmético — define de qué lado del problema está
 * parado quien mira.
 *
 * Y por eso sale del **alcance del usuario** y no de un parámetro que el
 * cliente elija: "entrante" significa "hacia un almacén que yo administro". Si
 * lo mandara el cliente, cualquiera podría pedir la bandeja de otro.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(user: AuthUser, scope: UserScope, options: ListTransfersOptions = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

    const where: Prisma.TransferWhereInput = {
      tenantId: user.tenantId,
      // En tránsito por default: lo que ya se recibió o se canceló es
      // historia, y esta pantalla existe para lo que está pendiente.
      status: options.status ?? "in_transit",
      ...(options.originWarehouseId !== undefined
        ? { originWarehouseId: options.originWarehouseId }
        : {}),
      ...(options.destinationWarehouseId !== undefined
        ? { destinationWarehouseId: options.destinationWarehouseId }
        : {}),
      ...this.rangoDeFechas(options),
      ...this.porAlcance(scope, options.direction),
    };

    const [total, rows, incomingCount, outgoingCount] = await this.prisma.withTenantContext(
      user.tenantId,
      async (tx) =>
        Promise.all([
          tx.transfer.count({ where }),
          tx.transfer.findMany({
            where,
            // El desempate por `id` no es decorativo: sin él, dos traspasos del
            // MISMO instante quedan en un orden que Postgres decide y que
            // cambia entre consultas — una fila podría salir en dos páginas o
            // en ninguna. Mismo criterio que el orden de presentaciones en F2.
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              status: true,
              createdAt: true,
              origin: { select: { id: true, name: true } },
              destination: { select: { id: true, name: true } },
              creator: { select: { id: true, firstName: true, lastNamePaternal: true } },
              _count: { select: { lines: true } },
              // Los DOS documentos del traspaso: la salida que lo despacha y,
              // si ya alguien empezó a recibir, la entrada en borrador. Un
              // traspaso no tiene serie propia, por eso se distinguen por tipo.
              //
              // La entrada se trae para no MENTIR en la lista: el traspaso
              // sigue "en tránsito" hasta que esa entrada se CONFIRMA —y está
              // bien que así sea, porque antes de contar lo que llegó nada
              // debe sumar en el destino—, pero un botón que sigue diciendo
              // "Recibir" hace parecer que el clic anterior no hizo nada.
              documents: {
                select: { id: true, folio: true, type: true },
                orderBy: { createdAt: "asc" },
              },
            },
          }),
          tx.transfer.count({
            where: { ...where, ...this.porAlcance(scope, "incoming") },
          }),
          tx.transfer.count({
            where: { ...where, ...this.porAlcance(scope, "outgoing") },
          }),
        ]),
    );

    const ahora = Date.now();

    return {
      rows: rows.map((row) => {
        // `Math.max(0, …)` no es paranoia: `created_at` lo pone la BASE con
        // `transaction_timestamp()`, y unos milisegundos de desfase entre el
        // reloj de la app y el del contenedor de Postgres bastan para que
        // `Math.floor` de un número negativo diminuto devuelva **-1**. Un
        // traspaso recién despachado diciendo "hace -1 días" es basura en
        // pantalla. Salir en el futuro no es un estado posible.
        const daysInTransit = Math.max(
          0,
          Math.floor((ahora - row.createdAt.getTime()) / MS_POR_DIA),
        );
        const despacho = row.documents.find((d) => d.type === "exit");
        const recepcion = row.documents.find((d) => d.type === "entry");

        return {
          id: row.id,
          documentId: despacho?.id ?? null,
          folio: despacho?.folio ?? null,
          /** El borrador de recepción, si alguien ya lo abrió. */
          receipt: recepcion ? { id: recepcion.id, folio: recepcion.folio } : null,
          status: row.status,
          origin: row.origin,
          destination: row.destination,
          createdAt: row.createdAt,
          createdBy: {
            id: row.creator.id,
            name: `${row.creator.firstName} ${row.creator.lastNamePaternal}`.trim(),
          },
          lineCount: row._count.lines,
          daysInTransit,
          isStale: daysInTransit > TRANSFER_STALE_DAYS,
        };
      }),
      total,
      page,
      pageSize,
      meta: { incomingCount, outgoingCount },
    };
  }

  /**
   * Cancelar un traspaso en tránsito.
   *
   * **El stock NO vuelve al origen**, y esta es la decisión más difícil de
   * explicar de todo el módulo. La salida ya ocurrió: hay un `SAL-…`
   * confirmado, movimientos asentados y un saldo que bajó. Todo eso es
   * historia y el sistema es append-only.
   *
   * Si la mercancía reaparece —volvió el camión, estaba en otro pallet— entra
   * con un `adjustment` explícito, hecho por alguien que sabe qué pasó y que
   * queda auditado con su nombre. Devolverla automáticamente sería inventar un
   * movimiento que nadie autorizó y, peor, **borrar la evidencia de que hubo
   * un problema**: mañana nadie podría explicar por qué el saldo bajó y subió
   * solo.
   *
   * Por eso también pide `inventory:manage` y no `inventory:movement`: es una
   * decisión de gestión, no una operación de todos los días.
   */
  async cancel(
    user: AuthUser,
    id: string,
    reason: string,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const transfer = await tx.transfer.findFirst({
        where: { id, tenantId: user.tenantId },
        select: {
          id: true,
          documents: {
            where: { type: "exit" },
            select: { id: true, folio: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      });
      if (transfer === null) {
        throw new NotFoundException({ message: "inventory.transfer_not_found" });
      }

      // El MISMO lock lógico de la recepción: solo se cancela lo que sigue en
      // viaje, y `rowCount` decide sin releer.
      const tomados = await tx.transfer.updateMany({
        where: { id, tenantId: user.tenantId, status: "in_transit" },
        data: {
          status: "canceled",
          canceledBy: user.userId,
          canceledAt: new Date(),
          cancelReason: reason,
        },
      });
      if (tomados.count !== 1) {
        throw new ConflictException({ message: "inventory.transfer_not_in_transit" });
      }

      const despacho = transfer.documents[0];
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "inventory.transfer_cancel",
        resourceType: "transfer",
        resourceId: id,
        before: undefined,
        after: {
          dispatchFolio: despacho?.folio ?? null,
          reason,
          // Dicho explícitamente en el rastro: quien audite mañana no tiene
          // que deducir que el saldo no volvió.
          stockReturned: false,
        } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return tx.transfer.findFirstOrThrow({
        where: { id },
        select: { id: true, status: true, cancelReason: true, canceledAt: true },
      });
    });
  }

  /**
   * Recibir un traspaso. Corre DENTRO de la transacción del `confirm`.
   *
   * **El lock es lógico y va PRIMERO**: `UPDATE … WHERE status='in_transit'`
   * con `rowCount = 1`. Sin él, dos personas confirmando la misma recepción a
   * la vez duplicarían el saldo del destino — el mismo bug que `markConfirmed`
   * evita en el documento. Tomarlo antes de validar nada más es lo que hace
   * que la segunda vea 409 en vez de trabajar de gusto.
   *
   * **La diferencia `enviado − recibido` NO entra al destino y NO genera una
   * merma automática.** Ya salió del origen; qué pasó en el camino —robo,
   * rotura, error de conteo— lo decide una persona con un ajuste explícito.
   * Inventar el asiento sería adivinar la causa.
   */
  async receive(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    document: {
      id: string;
      transferId: string | null;
      warehouseId: string;
      reasonNote: string | null;
    },
    lines: { productId: string; lotId?: string; quantityBase: Prisma.Decimal }[],
  ) {
    if (document.transferId === null) {
      throw new UnprocessableEntityException({
        message: "inventory.transfer_entry_requires_transfer",
        args: { field: "transferId" },
      });
    }

    // El lock, antes que todo lo demás.
    const tomados = await tx.transfer.updateMany({
      where: { id: document.transferId, tenantId: user.tenantId, status: "in_transit" },
      data: { status: "completed", receivedBy: user.userId, receivedAt: new Date() },
    });
    if (tomados.count !== 1) {
      throw new ConflictException({ message: "inventory.transfer_not_in_transit" });
    }

    const transfer = await tx.transfer.findFirstOrThrow({
      where: { id: document.transferId, tenantId: user.tenantId },
      select: {
        id: true,
        originWarehouseId: true,
        destinationWarehouseId: true,
        lines: { select: { id: true, productId: true, lotId: true, quantitySent: true } },
        documents: {
          where: { type: "exit" },
          select: { folio: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    if (document.warehouseId !== transfer.destinationWarehouseId) {
      throw new UnprocessableEntityException({
        message: "inventory.transfer_wrong_destination",
        args: { field: "warehouseId" },
      });
    }

    // Se identifica por producto + LOTE: lo que salió de un lote entra al
    // mismo lote, con su misma caducidad. Dos lotes del mismo producto son dos
    // líneas y no se pueden confundir entre sí.
    const clave = (productId: string, lotId: string | null | undefined) =>
      `${productId}|${lotId ?? ""}`;
    const esperadas = new Map(transfer.lines.map((l) => [clave(l.productId, l.lotId), l]));

    const recibido = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const key = clave(line.productId, line.lotId);
      if (!esperadas.has(key)) {
        throw new UnprocessableEntityException({
          message: "inventory.transfer_line_unknown",
          args: { productId: line.productId },
        });
      }
      recibido.set(key, (recibido.get(key) ?? new Prisma.Decimal(0)).plus(line.quantityBase));
    }

    let hayFaltante = false;
    const detalle: { productId: string; sent: string; received: string; difference: string }[] = [];

    for (const [key, esperada] of esperadas) {
      const cantidad = recibido.get(key);
      if (cantidad === undefined) {
        // Recibir CERO es un estado válido (la línea se perdió entera), pero
        // hay que declararlo: omitir la línea es dejar el traspaso a medio
        // cerrar, y el saldo del origen ya se fue.
        throw new UnprocessableEntityException({
          message: "inventory.transfer_lines_incomplete",
          args: { productId: esperada.productId },
        });
      }
      if (cantidad.greaterThan(esperada.quantitySent)) {
        throw new UnprocessableEntityException({
          message: "inventory.received_exceeds_sent",
          args: {
            productId: esperada.productId,
            sent: esperada.quantitySent.toString(),
            received: cantidad.toString(),
          },
        });
      }
      const diferencia = esperada.quantitySent.minus(cantidad);
      if (diferencia.greaterThan(0)) {
        hayFaltante = true;
      }
      detalle.push({
        productId: esperada.productId,
        sent: esperada.quantitySent.toString(),
        received: cantidad.toString(),
        difference: diferencia.toString(),
      });
      await tx.transferLine.update({
        where: { id: esperada.id },
        data: { quantityReceived: cantidad },
      });
    }

    // Un faltante sin explicación no se acepta: alguien tiene que hacerse
    // cargo de la diferencia, y la nota es dónde queda dicho.
    if (hayFaltante) {
      const nota = document.reasonNote?.trim() ?? "";
      if (nota === "") {
        throw new BadRequestException({
          message: "inventory.note_required",
          errors: [{ key: "reasonNote", message: "inventory.note_required" }],
        });
      }
      await tx.transfer.update({
        where: { id: transfer.id },
        data: { discrepancyNote: nota },
      });
    }

    return {
      id: transfer.id,
      status: "completed" as const,
      originWarehouseId: transfer.originWarehouseId,
      dispatchFolio: transfer.documents[0]?.folio ?? null,
      lines: detalle,
    };
  }

  /**
   * El borrador de RECEPCIÓN: una Entrada normal, precargada.
   *
   * **La recepción no tiene pantalla propia.** Este borrador nace con motivo
   * `transfer`, el almacén destino y las líneas con lo que se envió, así que
   * se completa en la misma pantalla que cualquier entrada — quien recibe solo
   * corrige lo que llegó de menos.
   *
   * El `linkedWarehouseId` (el origen) lo pone el SERVIDOR: quien recibe no
   * tiene por qué saber de dónde vino, y dejarlo elegir sería dejarlo
   * equivocarse.
   *
   * **Idempotente**, y no por un guard sino por el UNIQUE parcial
   * `(transfer_id, type) WHERE transfer_id IS NOT NULL`: pedirlo dos veces
   * devuelve el mismo. Se busca primero por el camino feliz y se reintenta la
   * búsqueda si el INSERT chocó, que es la única forma de cubrir la carrera
   * entre dos pedidos simultáneos.
   */
  async createReceiptDraft(user: AuthUser, scope: UserScope, transferId: string) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const transfer = await tx.transfer.findFirst({
        where: { id: transferId, tenantId: user.tenantId },
        select: {
          id: true,
          status: true,
          originWarehouseId: true,
          destinationWarehouseId: true,
          lines: {
            orderBy: { createdAt: "asc" },
            select: {
              productId: true,
              quantitySent: true,
              lot: { select: { lotCode: true, expiresAt: true } },
            },
          },
        },
      });
      if (transfer === null) {
        throw new NotFoundException({ message: "inventory.transfer_not_found" });
      }

      const existente = await tx.inventoryDocument.findFirst({
        where: { transferId, type: "entry", tenantId: user.tenantId },
        include: { warehouse: { select: { id: true, name: true } } },
      });
      if (existente !== null) {
        return existente;
      }

      // Después de la idempotencia: si el borrador YA existe, devolverlo aunque
      // el traspaso esté completado es lo correcto —es el documento con el que
      // se recibió—. Lo que no se puede es abrir uno nuevo.
      if (transfer.status !== "in_transit") {
        throw new ConflictException({ message: "inventory.transfer_not_in_transit" });
      }
      assertWarehouseInScope(scope, transfer.destinationWarehouseId);
      await assertActiveWarehouse(tx, user.tenantId, transfer.destinationWarehouseId);

      const folio = await nextFolio(tx, user.tenantId, "entry", FOLIO_PREFIXES.entry);
      const document = await tx.inventoryDocument.create({
        data: {
          tenantId: user.tenantId,
          folio,
          type: "entry",
          warehouseId: transfer.destinationWarehouseId,
          reasonCode: "transfer",
          transferId: transfer.id,
          linkedWarehouseId: transfer.originWarehouseId,
          createdBy: user.userId,
          lines: {
            create: transfer.lines.map((line, index) => ({
              tenantId: user.tenantId,
              lineNo: index + 1,
              productId: line.productId,
              quantity: line.quantitySent,
              lotCode: line.lot?.lotCode ?? null,
              // La caducidad viaja con el lote, así que al confirmar se
              // resolvería igual desde `product_lots` — pero quien descarga el
              // camión necesita VERLA para cotejarla contra la caja física.
              // Recibir mercancía controlada sin poder mirar la fecha es no
              // recibirla. Va la del lote, no una que el receptor teclee: si
              // difieren, `resolveLot` corta con `lot_expiry_mismatch`.
              expiresAt: line.lot?.expiresAt ?? null,
            })),
          },
        },
        include: { warehouse: { select: { id: true, name: true } } },
      });

      return document;
    });
  }

  /**
   * El detalle: lo que mira quien va a recibir.
   *
   * `difference` se DERIVA de `sent - received` y no se guarda — una sola
   * verdad, la misma decisión que tomó F3-DB-02 al descartar un JSONB de
   * discrepancias. Y es `null` mientras nadie recibió, porque **`null` no es
   * lo mismo que 0**: recibir cero significa "llegó vacío", una pérdida total
   * que hay que ver; confundirlos la borraría del reporte.
   *
   * 404 —y no 403— para quien no está en ninguna de las dos puntas: ese
   * traspaso no existe para él. Un 403 confirmaría que sí, y de paso revelaría
   * que hay movimiento entre dos bodegas que no le tocan.
   */
  async detail(user: AuthUser, scope: UserScope, id: string) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const transfer = await tx.transfer.findFirst({
        where: { id, tenantId: user.tenantId },
        select: {
          id: true,
          status: true,
          createdAt: true,
          receivedAt: true,
          canceledAt: true,
          cancelReason: true,
          discrepancyNote: true,
          originWarehouseId: true,
          destinationWarehouseId: true,
          origin: { select: { id: true, name: true } },
          destination: { select: { id: true, name: true } },
          creator: { select: { id: true, firstName: true, lastNamePaternal: true } },
          receiver: { select: { id: true, firstName: true, lastNamePaternal: true } },
          canceller: { select: { id: true, firstName: true, lastNamePaternal: true } },
          documents: {
            where: { type: "exit" },
            select: { id: true, folio: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
          lines: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              productId: true,
              quantitySent: true,
              quantityReceived: true,
              product: { select: { sku: true, name: true, baseUnit: true } },
              lot: { select: { id: true, lotCode: true, expiresAt: true } },
            },
          },
        },
      });

      if (transfer === null) {
        throw new NotFoundException({ message: "inventory.transfer_not_found" });
      }

      // Basta con estar en UNA de las dos puntas: al origen le importa que
      // llegue y al destino que le llegue.
      const alcanzable =
        scope.warehouseIds === "all" ||
        scope.warehouseIds.includes(transfer.originWarehouseId) ||
        scope.warehouseIds.includes(transfer.destinationWarehouseId);
      if (!alcanzable) {
        throw new NotFoundException({ message: "inventory.transfer_not_found" });
      }

      const despacho = transfer.documents[0];

      return {
        id: transfer.id,
        documentId: despacho?.id ?? null,
        folio: despacho?.folio ?? null,
        status: transfer.status,
        origin: transfer.origin,
        destination: transfer.destination,
        createdAt: transfer.createdAt,
        createdBy: this.persona(transfer.creator),
        receivedAt: transfer.receivedAt,
        receivedBy: this.persona(transfer.receiver),
        canceledAt: transfer.canceledAt,
        canceledBy: this.persona(transfer.canceller),
        cancelReason: transfer.cancelReason,
        discrepancyNote: transfer.discrepancyNote,
        lines: transfer.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          sku: line.product.sku,
          name: line.product.name,
          baseUnit: line.product.baseUnit,
          // El lote no está en el contrato del tablero, pero la RECEPCIÓN lo
          // necesita: lo que sale del origen entra al destino como el MISMO
          // lote (F3-TRANSFER-03). Omitirlo obligaría a tocar este endpoint de
          // nuevo en la tarea siguiente.
          lot: line.lot,
          quantitySent: line.quantitySent.toString(),
          quantityReceived: line.quantityReceived?.toString() ?? null,
          difference:
            line.quantityReceived === null
              ? null
              : line.quantitySent.minus(line.quantityReceived).toString(),
        })),
      };
    });
  }

  /** `null` cuando todavía no hay nadie: sin recibir, sin cancelar. */
  private persona(
    row: { id: string; firstName: string; lastNamePaternal: string } | null,
  ): { id: string; name: string } | null {
    return row === null
      ? null
      : { id: row.id, name: `${row.firstName} ${row.lastNamePaternal}`.trim() };
  }

  /**
   * De qué lado está el usuario.
   *
   * Con alcance `"all"` —el default permisivo de un negocio que nunca asignó
   * alcances— NO se filtra: no hay "mi almacén" contra el que contrastar, así
   * que los dos tabs muestran todo. Distinguirlo del alcance vacío importa:
   * `[]` es el fail-closed del interceptor y tiene que seguir sin ver nada.
   *
   * Sin `direction`, un traspaso entra si el usuario está en CUALQUIERA de las
   * dos puntas: le concierne igual, sea porque lo mandó o porque lo espera.
   */
  private porAlcance(
    scope: UserScope,
    direction?: "incoming" | "outgoing",
  ): Prisma.TransferWhereInput {
    if (scope.warehouseIds === "all") {
      return {};
    }
    const míos = { in: scope.warehouseIds };

    if (direction === "incoming") {
      return { destinationWarehouseId: míos };
    }
    if (direction === "outgoing") {
      return { originWarehouseId: míos };
    }
    return { OR: [{ originWarehouseId: míos }, { destinationWarehouseId: míos }] };
  }

  /**
   * `olderThanDays` y `from`/`to` se combinan: el primero pone un techo (salió
   * hace AL MENOS N días) y los otros una ventana. Pedir los dos es raro pero
   * no contradictorio, y resolverlo acá evita que el controller decida.
   */
  private rangoDeFechas(options: ListTransfersOptions): Prisma.TransferWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};

    if (options.from !== undefined) {
      createdAt.gte = options.from;
    }
    if (options.to !== undefined) {
      createdAt.lte = options.to;
    }
    if (options.olderThanDays !== undefined) {
      const corte = new Date(Date.now() - options.olderThanDays * MS_POR_DIA);
      // El más restrictivo gana: si ya había un `to`, se queda el menor.
      createdAt.lte =
        createdAt.lte === undefined || corte < (createdAt.lte as Date) ? corte : createdAt.lte;
    }

    return Object.keys(createdAt).length > 0 ? { createdAt } : {};
  }
}
