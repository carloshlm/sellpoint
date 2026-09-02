import { Injectable, NotFoundException } from "@nestjs/common";
import { localCalendarDate } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { nextSequenceValue } from "../inventory/folio";
import type { CreateTurnDto, ListTurnsQuery } from "./dto/turns.dto";

export type TurnStatus = "waiting" | "attended";

export interface TurnSummary {
  id: string;
  number: number;
  /** El día del negocio al que pertenece, `YYYY-MM-DD`. */
  businessDate: string;
  customerId: string | null;
  customerName: string | null;
  status: TurnStatus;
  attendedAt: string | null;
  createdAt: string;
}

type TurnRow = {
  id: string;
  number: number;
  businessDate: Date;
  customerId: string | null;
  customerName: string | null;
  status: string;
  attendedAt: Date | null;
  createdAt: Date;
};

/** Un día son decenas de turnos; el tope es defensivo, no una página. */
const MAX_TURNOS_POR_DIA = 500;

/**
 * F9-RECEP-07 — los turnos de Recepción y el número que reinicia cada día.
 *
 * ── El reinicio no es un reset ─────────────────────────────────────────
 *
 * Cada DÍA DEL NEGOCIO es una serie nueva en `tenant_sequences`
 * (`reception_turn:YYYYMMDD`), igual que el código de ticket del POS: la
 * unicidad es estructural y no hay carrera que perder. El día es el del
 * calendario del negocio (`tenant.timezone`), no el de UTC: a las 22:30 de
 * CDMX el 2 de septiembre, UTC ya está en el 3.
 *
 * ── Un solo instante ───────────────────────────────────────────────────
 *
 * `new Date()` se toma UNA vez por turno y de él salen la serie y
 * `business_date`. Con dos, un turno a las 23:59:59.999 tomaría el
 * consecutivo de hoy y se guardaría con la fecha de mañana — el bug de una
 * vez al año, imposible de reproducir.
 *
 * ── La transacción es CORTA a propósito ────────────────────────────────
 *
 * `nextSequenceValue` sostiene el lock de `(tenant, key)` hasta el COMMIT
 * (ver el docblock de `inventory/folio.ts`). Acá la tx solo crea el turno y
 * audita, así que el lock dura milisegundos aunque dos recepcionistas
 * generen a la vez.
 */
@Injectable()
export class TurnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: AuthUser, input: CreateTurnDto, meta: RequestMeta): Promise<TurnSummary> {
    const zona = await this.zonaDelNegocio(user.tenantId);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      let customerId: string | null = null;
      let customerName: string | null = null;
      if (input.customerId) {
        const cliente = await tx.customer.findFirst({
          where: { id: input.customerId, tenantId: user.tenantId },
          select: { id: true, firstName: true, lastNamePaternal: true, lastNameMaternal: true },
        });
        if (!cliente) {
          throw new NotFoundException({ message: "reception.customer_not_found" });
        }
        customerId = cliente.id;
        // El snapshot: si mañana borran al cliente, el historial del día sigue
        // diciendo a quién se atendió.
        customerName = [cliente.firstName, cliente.lastNamePaternal, cliente.lastNameMaternal]
          .filter((parte): parte is string => Boolean(parte))
          .join(" ")
          .slice(0, 200);
      }

      const instante = new Date();
      const fechaLocal = localCalendarDate(zona, instante);
      const consecutivo = await nextSequenceValue(
        tx,
        user.tenantId,
        `reception_turn:${fechaLocal.replaceAll("-", "")}`,
      );
      const creado = await tx.receptionTurn.create({
        data: {
          tenantId: user.tenantId,
          // `new Date("YYYY-MM-DD")` es medianoche UTC de ESE día: lo que una
          // columna DATE necesita. Con el instante crudo, un turno de la tarde
          // en CDMX caería en el día siguiente y el listado de hoy saldría vacío.
          businessDate: new Date(fechaLocal),
          number: Number(consecutivo),
          customerId,
          customerName,
          createdBy: user.userId,
        },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "reception.turn.create",
        resourceType: "reception_turn",
        resourceId: creado.id,
        after: { number: creado.number, businessDate: fechaLocal, customerId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(creado);
    });
  }

  async list(user: AuthUser, query: ListTurnsQuery): Promise<TurnSummary[]> {
    const fechaLocal =
      query.date ?? localCalendarDate(await this.zonaDelNegocio(user.tenantId), new Date());
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const filas = await tx.receptionTurn.findMany({
        where: { tenantId: user.tenantId, businessDate: new Date(fechaLocal) },
        // Del número mayor al menor (Carlos, 2026-09-02): el último que llegó, arriba.
        orderBy: [{ number: "desc" }],
        take: MAX_TURNOS_POR_DIA,
      });
      return filas.map(toSummary);
    });
  }

  /** Idempotente: atender dos veces es un doble clic, no un error de negocio. */
  async attend(user: AuthUser, id: string, meta: RequestMeta): Promise<TurnSummary> {
    return this.cambiarEstado(user, id, "attended", meta);
  }

  /** Marcar el turno equivocado va a pasar el primer día: esto lo deshace. */
  async wait(user: AuthUser, id: string, meta: RequestMeta): Promise<TurnSummary> {
    return this.cambiarEstado(user, id, "waiting", meta);
  }

  private async cambiarEstado(
    user: AuthUser,
    id: string,
    status: TurnStatus,
    meta: RequestMeta,
  ): Promise<TurnSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await tx.receptionTurn.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!actual) {
        throw new NotFoundException({ message: "reception.turn_not_found" });
      }
      if (actual.status === status) {
        return toSummary(actual);
      }
      const actualizado = await tx.receptionTurn.update({
        where: { id },
        data:
          status === "attended"
            ? { status, attendedAt: new Date(), attendedBy: user.userId }
            : { status, attendedAt: null, attendedBy: null },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: status === "attended" ? "reception.turn.attend" : "reception.turn.wait",
        resourceType: "reception_turn",
        resourceId: id,
        before: { status: actual.status },
        after: { status },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(actualizado);
    });
  }

  private async zonaDelNegocio(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? "UTC";
  }
}

function toSummary(row: TurnRow): TurnSummary {
  return {
    id: row.id,
    number: row.number,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    customerId: row.customerId,
    customerName: row.customerName,
    status: row.status as TurnStatus,
    attendedAt: row.attendedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
