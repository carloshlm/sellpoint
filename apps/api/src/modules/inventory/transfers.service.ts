import { Injectable } from "@nestjs/common";
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
