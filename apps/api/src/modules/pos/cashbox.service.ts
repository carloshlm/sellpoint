import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import {
  assertActiveWarehouse,
  assertWarehouseInScope,
} from "../inventory/warehouse-scope.helpers";
import {
  efectivoEsperado,
  gastosEnEfectivoPorSesion,
  type SessionCashExpenses,
  sinGastos,
} from "./cashbox-expenses";
import { type SessionTotal, totalesEnCero, totalesPorSesion } from "./cashbox-totals";
import type { CloseSessionDto, OpenSessionDto } from "./dto/open-session.dto";

/**
 * F4-CASHBOX-01 — el TURNO de caja: desde dónde y desde cuándo vende alguien.
 *
 * ── Por qué el turno existe y no se vende "a secas" ─────────────────────
 *
 * El POS **no puede vender desde una lista**. El alcance de un usuario dice
 * dónde PUEDE operar (puede ser `all` o varios almacenes) y su almacén
 * asignado dice desde dónde opera por defecto — pero descontar stock exige UNO
 * concreto, elegido y registrado. El turno es quien lo fija, y la venta lo
 * hereda de él: `usuario.asignado → turno → venta → ledger`.
 *
 * Sin turno no se vende (409 `pos.no_session`), y eso no es burocracia: es lo
 * que hace que un arqueo signifique algo. Ventas sueltas sin turno serían
 * dinero que nadie cuadra al final del día.
 */
/**
 * Lo que el cierre muestra y persiste: ventas por método, gastos del cajón, el
 * fondo con que abrió y el esperado.
 */
export interface SessionArqueo {
  totals: SessionTotal[];
  cashExpenses: SessionCashExpenses;
  /** F10-MANFIX-10: el fondo inicial del turno, como texto decimal («0» sin fondo). */
  openingCash: string;
  /** Fondo + ventas en efectivo − gastos en efectivo: contra esto se cuenta el cajón. */
  expectedCash: string;
}

/**
 * Lo que el arqueo necesita del turno: cuál es y con cuánto abrió. Exportado
 * porque viaja en la firma de un método público (`nest build` emite
 * declaraciones y no acepta un nombre que no se pueda importar).
 */
export type TurnoDelArqueo = { id: string; openingCash: Prisma.Decimal };

@Injectable()
export class CashboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El turno abierto del usuario, o `null`.
   *
   * Del USUARIO y no del almacén: dos cajeros en el mismo mostrador tienen
   * turnos distintos porque cada uno cuadra su propia caja.
   */
  async current(user: AuthUser) {
    return this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.cashboxSession.findFirst({
        where: { tenantId: user.tenantId, openedBy: user.userId, status: "open" },
        include: { warehouse: { select: { id: true, name: true } } },
      }),
    );
  }

  /**
   * Abre el turno.
   *
   * ── El 409 sale de la BASE, no de un `if` ───────────────────────────────
   *
   * Hay un UNIQUE parcial `(opened_by) WHERE status = 'open'`. Podría haberse
   * chequeado con un `findFirst` antes de insertar, y estaría mal: entre la
   * lectura y la escritura caben dos pestañas, y el resultado serían dos
   * turnos abiertos del mismo cajero — dos arqueos que se pisan. Acá la
   * condición la evalúa Postgres sobre la fila, y el segundo intento choca.
   *
   * El `try/catch` traduce ese choque (P2002) al 409 con mensaje, en vez de
   * dejar salir un 500 que nadie entiende. Es el mismo patrón que
   * `markConfirmed` en F3.
   *
   * F10-MANFIX-10: el fondo inicial se guarda EN el turno, tal como lo
   * escribió quien abre. Sin él, la columna queda en su default ($0). Se fija
   * una vez: el turno no tiene cómo editarlo después, y el arqueo lo lee de
   * aquí.
   */
  async open(user: AuthUser, scope: UserScope, dto: OpenSessionDto) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const warehouseId = dto.warehouseId ?? (await this.almacenAsignado(tx, user));

      assertWarehouseInScope(scope, warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, warehouseId);

      try {
        return await tx.cashboxSession.create({
          data: {
            tenantId: user.tenantId,
            warehouseId,
            openedBy: user.userId,
            ...(dto.openingCash !== undefined && {
              openingCash: new Prisma.Decimal(dto.openingCash),
            }),
          },
          include: { warehouse: { select: { id: true, name: true } } },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // No se devuelve el turno vivo en el cuerpo del error a propósito:
          // quien recibe un 409 tiene que ir a `GET /pos/session`, que es la
          // fuente de verdad. Adjuntarlo acá sería una segunda copia que un
          // día dirá otra cosa.
          throw new ConflictException({ message: "pos.session_already_open" });
        }
        throw error;
      }
    });
  }

  /**
   * Los totales del turno, POR MÉTODO de pago.
   *
   * Las ventas ANULADAS no suman: su dinero no está en el cajón. Pero tampoco
   * se esconden — quedan en el historial marcadas (F4-SALE-04), que es donde
   * alguien puede preguntarse por qué el turno cerró con menos de lo que
   * recordaba.
   */
  async totals(user: AuthUser, session: TurnoDelArqueo): Promise<SessionArqueo> {
    // La MISMA función que el reporte de cierres (F5-SHIFT-01): el papel del
    // cierre y el reporte no pueden decir cosas distintas.
    return this.prisma.withTenantContext(user.tenantId, (tx) =>
      this.arqueo(tx, user.tenantId, session),
    );
  }

  /**
   * F9-EXP-09 — lo vendido por método, los gastos en efectivo que salieron
   * del cajón y el efectivo ESPERADO. La cuenta va aparte de `totals`: la
   * columna «Efectivo» sigue siendo ventas.
   *
   * F10-MANFIX-10: el esperado suma el fondo inicial del turno —fondo +
   * ventas cash − gastos cash— y el fondo viaja en la respuesta, para que la
   * pantalla lo muestre en su renglón en vez de deducirlo.
   */
  private async arqueo(
    tx: Prisma.TransactionClient,
    tenantId: string,
    session: TurnoDelArqueo,
  ): Promise<SessionArqueo> {
    const [porMetodo, gastos] = await Promise.all([
      totalesPorSesion(tx, tenantId, [session.id]),
      gastosEnEfectivoPorSesion(tx, tenantId, [session.id]),
    ]);
    const totals = porMetodo.get(session.id) ?? totalesEnCero();
    const cashExpenses = gastos.get(session.id) ?? sinGastos();
    const openingCash = session.openingCash.toString();
    const ventasCash = totals.find((t) => t.method === "cash")?.total ?? "0";
    return {
      totals,
      cashExpenses,
      openingCash,
      expectedCash: efectivoEsperado({
        fondo: openingCash,
        ventas: ventasCash,
        gastos: cashExpenses.total,
      }),
    };
  }

  /**
   * Cierra el turno con su arqueo.
   *
   * ── La diferencia se REGISTRA, no bloquea ───────────────────────────────
   *
   * Un turno que no cuadra igual se cierra. Bloquearlo obligaría al cajero a
   * "encontrar" el número que el sistema quiere — y lo encontraría, escribiendo
   * el calculado en vez de lo que contó. El descuadre escondido es peor que el
   * descuadre visible: uno se investiga, el otro se repite.
   *
   * Se guardan las TRES cifras y no solo la resta: lo declarado por quien
   * contó, lo calculado por el sistema, y su diferencia. Guardar solo la resta
   * perdería quién dijo qué, que es justo lo que se audita cuando no cuadra.
   *
   * El lock es LÓGICO y va primero (`updateMany … WHERE status='open'` con
   * `count = 1`): dos cierres simultáneos del mismo turno escribirían dos
   * arqueos distintos sobre la misma fila.
   */
  async close(user: AuthUser, dto: CloseSessionDto) {
    const sesion = await this.current(user);
    if (sesion === null) {
      throw new ConflictException({ message: "pos.no_session" });
    }

    const declarado = new Prisma.Decimal(dto.declaredCash);

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      // El lock lógico PRIMERO, y el cálculo DESPUÉS y dentro de la misma tx
      // (F9-EXP-09): antes se calculaba fuera, y una venta o un gasto que
      // entrara entre la lectura y el `updateMany` quedaba fuera del
      // `calculatedCash` persistido mientras el reporte (que recalcula) decía
      // otra cosa que el papel. Con la fila tomada, un gasto en efectivo que
      // quiera ligarse (`FOR UPDATE` sobre la sesión) espera y encuentra el
      // turno cerrado.
      const tomadas = await tx.cashboxSession.updateMany({
        where: { id: sesion.id, tenantId: user.tenantId, status: "open" },
        data: { status: "closed", closedBy: user.userId, closedAt: new Date() },
      });
      if (tomadas.count !== 1) {
        throw new ConflictException({ message: "pos.session_already_closed" });
      }

      // El fondo se lee del turno que `current` trajo: se fija al abrir y
      // nada lo cambia después, así que no hay carrera que tomar en cuenta.
      const arqueo = await this.arqueo(tx, user.tenantId, sesion);
      const calculado = new Prisma.Decimal(arqueo.expectedCash);
      const cerrada = await tx.cashboxSession.update({
        where: { id: sesion.id },
        data: {
          declaredCash: declarado,
          calculatedCash: calculado,
          cashDifference: declarado.minus(calculado),
          ...(dto.note !== undefined && { closingNote: dto.note }),
        },
        include: { warehouse: { select: { id: true, name: true } } },
      });

      return { session: cerrada, ...arqueo };
    });
  }

  /**
   * El almacén asignado del usuario (F3-HOME).
   *
   * Si no tiene, el cliente debe mandar `warehouseId` explícito: adivinar
   * "el primero del tenant" pondría a vender desde una sucursal que el cajero
   * no eligió, y el error se descubriría recién al cuadrar la caja.
   */
  private async almacenAsignado(tx: Prisma.TransactionClient, user: AuthUser): Promise<string> {
    const fila = await tx.user.findFirst({
      where: { id: user.userId, tenantId: user.tenantId },
      select: { defaultWarehouseId: true },
    });

    if (fila?.defaultWarehouseId == null) {
      throw new NotFoundException({ message: "pos.no_default_warehouse" });
    }
    return fila.defaultWarehouseId;
  }
}
