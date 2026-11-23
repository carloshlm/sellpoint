import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { type Currency, formatMoney, isDiscountCode } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { AuthorizationCodeService } from "./authorization-code.service";
import {
  CASH_MOVEMENT_ROW_INCLUDE,
  type CashMovementRow,
  movimientosDeSesion,
  toCashMovementRow,
} from "./cash-movements";
import { CashboxService, type TurnoDelArqueo } from "./cashbox.service";
import type {
  CancelCashMovementDto,
  CashMovementTypeCode,
  CreateCashMovementDto,
} from "./dto/cash-movement.dto";

// La fila vive en `cash-movements.ts` (F10-CASHMOV-06): la comparte el detalle
// de «Cierres de turno». Se reexporta para quien ya la importaba de aquí.
export type { CashMovementPerson, CashMovementRow } from "./cash-movements";

/** `GET /pos/session/movements`: los del turno abierto propio, del más nuevo al más viejo. */
export interface CashMovementList {
  movements: CashMovementRow[];
}

/** Lo que hace falta saber de un movimiento para decidir si se puede anular. */
type MovimientoAAnular = {
  type: CashMovementTypeCode;
  status: "active" | "canceled";
  amount: Prisma.Decimal;
  cashboxSessionId: string;
  cashboxSession: { status: "open" | "closed" };
};

/**
 * F10-CASHMOV-02 — las ENTRADAS y los RETIROS de efectivo del turno: el fondo
 * que se trae para dar cambio, el efectivo que se lleva a la caja fuerte o al
 * banco, lo que se lleva el dueño. No es un gasto: no toca la utilidad, solo
 * el efectivo esperado del turno (lo cuenta `efectivoEsperado`, F10-CASHMOV-03).
 *
 * ── Las reglas ──────────────────────────────────────────────────────────
 *
 * · Lo registra quien tiene el turno abierto, en SU turno, con `pos:sell`: el
 *   Cajero también. No hay forma de mandar el turno: es el abierto de quien
 *   llama.
 * · Un retiro pide el código de autorización del negocio, si el negocio lo
 *   tiene; sin código configurado, pasa y queda quién lo hizo. Anular una
 *   ENTRADA también lo pide, porque también baja el esperado. Anular un retiro,
 *   nunca: sube el esperado.
 * · Un retiro, o la anulación de una entrada, no puede dejar el esperado
 *   debajo de cero: así un dedazo (10,000 por 1,000) no pasa sin que se vea.
 * · Se anula mientras el turno está abierto, con motivo, y nunca se borra.
 *
 * ── El cierre al mismo tiempo ───────────────────────────────────────────
 *
 * Registrar y anular toman la fila del turno con `FOR UPDATE`, como el gasto
 * en efectivo (`ExpensesService.assertSesionElegible`). El cierre aparta el
 * turno con un `UPDATE` sobre esa misma fila, así que los dos se forman: si el
 * movimiento llega primero, el cierre lo espera y lo cuenta; si llega el
 * cierre, el movimiento encuentra el turno cerrado y rebota.
 */
@Injectable()
export class CashMovementsService {
  private readonly logger = new Logger(CashMovementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbox: CashboxService,
    private readonly authorizationCode: AuthorizationCodeService,
    private readonly audit: AuditService,
  ) {}

  /** Los movimientos del turno abierto propio. Sin turno, la lista vacía: no es un error. */
  async list(user: AuthUser): Promise<CashMovementList> {
    const sesion = await this.cashbox.current(user);
    if (sesion === null) {
      return { movements: [] };
    }
    return this.prisma.withTenantContext(user.tenantId, async (tx) => ({
      movements: await movimientosDeSesion(tx, user.tenantId, sesion.id, "desc"),
    }));
  }

  async create(
    user: AuthUser,
    dto: CreateCashMovementDto,
    meta: RequestMeta,
  ): Promise<CashMovementRow> {
    const sesion = await this.cashbox.current(user);
    if (sesion === null) {
      throw new ConflictException({ message: "pos.no_session" });
    }
    // El código se verifica ANTES de la transacción, como el del descuento:
    // argon2 (~50 ms) no tiene por qué alargar el lock del turno.
    const authorized = dto.type === "out" ? await this.autorizar(user, dto.code) : false;
    const importe = new Prisma.Decimal(dto.amount);

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.tomarTurno(tx, user, sesion.id, "pos.no_session");
      if (dto.type === "out") {
        await this.assertAlcanza(tx, user, sesion, importe);
      }
      const creado = await tx.cashMovement.create({
        data: {
          tenantId: user.tenantId,
          cashboxSessionId: sesion.id,
          type: dto.type,
          reason: dto.reason,
          amount: importe,
          note: dto.note ? dto.note : null,
          authorized,
          createdBy: user.userId,
        },
        include: CASH_MOVEMENT_ROW_INCLUDE,
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "pos.cash_movement.create",
        resourceType: "cash_movement",
        resourceId: creado.id,
        after: {
          cashboxSessionId: sesion.id,
          type: creado.type,
          reason: creado.reason,
          amount: creado.amount.toString(),
          note: creado.note,
          authorized,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toCashMovementRow(creado);
    });
  }

  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelCashMovementDto,
    meta: RequestMeta,
  ): Promise<CashMovementRow> {
    const sesion = await this.cashbox.current(user);
    if (sesion === null) {
      throw new ConflictException({ message: "pos.no_session" });
    }
    // Primero lo barato: si no se puede anular, ni se pide el código ni se
    // gasta un intento.
    const previo = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      this.buscarParaAnular(tx, user, id),
    );
    assertAnulable(previo, sesion.id);
    const authorized = previo.type === "in" ? await this.autorizar(user, dto.code) : false;

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.tomarTurno(tx, user, sesion.id, "pos.cash_movement_session_closed");
      // Otra vez, ya con la fila del turno tomada: otra pestaña pudo anularlo.
      const actual = await this.buscarParaAnular(tx, user, id);
      assertAnulable(actual, sesion.id);
      if (actual.type === "in") {
        await this.assertAlcanza(tx, user, sesion, actual.amount);
      }
      const anulado = await tx.cashMovement.update({
        where: { id },
        data: {
          status: "canceled",
          canceledBy: user.userId,
          canceledAt: new Date(),
          cancelReason: dto.reason,
        },
        include: CASH_MOVEMENT_ROW_INCLUDE,
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "pos.cash_movement.cancel",
        resourceType: "cash_movement",
        resourceId: id,
        before: { status: "active" },
        after: { status: "canceled", reason: dto.reason, authorized },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toCashMovementRow(anulado);
    });
  }

  /**
   * El código de autorización, si el negocio lo tiene. Sin código configurado
   * no hay nada que pedir: pasa sin autorización (`false`). Con código, sin
   * mandarlo es 422; mandado, lo verifica `AuthorizationCodeService` con la
   * cuenta de intentos del descuento.
   *
   * F10-PEND-02: la FORMA del código (4 a 8 dígitos) se revisa aquí y no en el
   * DTO, porque solo aquí se sabe si hace falta. En el DTO, un código mal
   * escrito tumbaba una entrada o la anulación de un retiro, que no lo piden.
   * Sigue siendo 400 y no gasta un intento, como en el descuento.
   */
  private async autorizar(user: AuthUser, code: string | null | undefined): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { discountCodeHash: true },
    });
    if (tenant?.discountCodeHash == null) {
      return false;
    }
    if (code == null) {
      throw new UnprocessableEntityException({ message: "pos.cash_movement_code_required" });
    }
    if (!isDiscountCode(code)) {
      // Con su `errors`, como lo respondía el DTO: el 400 conserva su forma.
      throw new BadRequestException({
        message: "pos.discount_code_invalid",
        errors: [{ key: "code", message: "pos.discount_code_invalid" }],
      });
    }
    await this.authorizationCode.verify(user, tenant.discountCodeHash, code, this.logger);
    return true;
  }

  /**
   * Toma la fila del turno con `FOR UPDATE` y comprueba, YA con ella tomada,
   * que siga abierto: el cierre pudo ganar entre la lectura y este punto.
   */
  private async tomarTurno(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    sessionId: string,
    siCerrado: string,
  ): Promise<void> {
    const filas = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM cashbox_sessions
       WHERE id = ${sessionId}::uuid AND tenant_id = ${user.tenantId}::uuid
       FOR UPDATE`;
    if (filas[0]?.status !== "open") {
      throw new ConflictException({ message: siCerrado });
    }
  }

  /**
   * Que lo que sale no deje el esperado debajo de cero. El esperado sale del
   * MISMO arqueo que el cierre (`CashboxService.arqueo`), dentro de esta
   * transacción y con el turno tomado: no hay una segunda fórmula.
   */
  private async assertAlcanza(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    sesion: TurnoDelArqueo,
    sale: Prisma.Decimal,
  ): Promise<void> {
    const esperado = new Prisma.Decimal(
      (await this.cashbox.arqueo(tx, user.tenantId, sesion)).expectedCash,
    );
    if (esperado.minus(sale).greaterThanOrEqualTo(0)) {
      return;
    }
    const tenant = await tx.tenant.findUnique({
      where: { id: user.tenantId },
      select: { currency: true },
    });
    // Un esperado que ya era negativo (un gasto mal cargado) se dice como $0:
    // es lo que de verdad se puede sacar del cajón.
    const hay = Prisma.Decimal.max(esperado, 0).toNumber();
    throw new UnprocessableEntityException({
      message: "pos.cash_out_exceeds_drawer",
      args: { available: formatMoney(hay, tenant?.currency as Currency | undefined, user.locale) },
    });
  }

  private buscarParaAnular(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    id: string,
  ): Promise<MovimientoAAnular | null> {
    return tx.cashMovement.findFirst({
      where: { id, tenantId: user.tenantId },
      select: {
        type: true,
        status: true,
        amount: true,
        cashboxSessionId: true,
        cashboxSession: { select: { status: true } },
      },
    });
  }
}

/**
 * Lo que impide anular, en orden: que no exista; que su turno ya cerró (con el
 * turno cerrado, ya no se toca); que sea del turno de otra persona; que ya
 * esté anulado.
 */
function assertAnulable(
  movimiento: MovimientoAAnular | null,
  sesionPropia: string,
): asserts movimiento is MovimientoAAnular {
  if (movimiento === null) {
    throw new NotFoundException({ message: "pos.cash_movement_not_found" });
  }
  if (movimiento.cashboxSession.status !== "open") {
    throw new ConflictException({ message: "pos.cash_movement_session_closed" });
  }
  if (movimiento.cashboxSessionId !== sesionPropia) {
    throw new ForbiddenException({ message: "pos.cash_movement_not_own" });
  }
  if (movimiento.status === "canceled") {
    throw new ConflictException({ message: "pos.cash_movement_already_canceled" });
  }
}
