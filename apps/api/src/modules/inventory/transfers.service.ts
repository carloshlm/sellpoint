import { Injectable, NotFoundException } from "@nestjs/common";
import { TRANSFER_STALE_DAYS } from "@sellpoint/shared";
import type { Prisma, TransferStatus } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";

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
  constructor(private readonly prisma: PrismaService) {}

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
              // El folio del DESPACHO: un traspaso no tiene serie propia. Los
              // documentos de un traspaso son dos —la salida que lo despacha y
              // la entrada que lo recibe—, así que se filtra por tipo.
              documents: {
                where: { type: "exit" },
                select: { id: true, folio: true },
                orderBy: { createdAt: "asc" },
                take: 1,
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
        const despacho = row.documents[0];

        return {
          id: row.id,
          documentId: despacho?.id ?? null,
          folio: despacho?.folio ?? null,
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
