import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import {
  assertActiveWarehouse,
  assertWarehouseInScope,
} from "../inventory/warehouse-scope.helpers";
import type { OpenSessionDto } from "./dto/open-session.dto";

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
   */
  async open(user: AuthUser, scope: UserScope, dto: OpenSessionDto) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const warehouseId = dto.warehouseId ?? (await this.almacenAsignado(tx, user));

      assertWarehouseInScope(scope, warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, warehouseId);

      try {
        return await tx.cashboxSession.create({
          data: { tenantId: user.tenantId, warehouseId, openedBy: user.userId },
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
