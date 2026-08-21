import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import {
  assertActiveWarehouse,
  assertWarehouseInScope,
} from "../inventory/warehouse-scope.helpers";
import { CashboxService } from "./cashbox.service";
import type { LookupQuery } from "./dto/lookup.dto";
import { LOOKUP_STRATEGIES, type LookupItem } from "./lookup.strategies";

/** Lo que el POS recibe de una búsqueda. */
export interface LookupResult {
  /** El almacén contra el que se resolvió: el del turno. */
  warehouseId: string;
  /**
   * `true` cuando respondió una strategy EXACTA (código de barras, SKU o
   * folio). El carrito lo usa para decidir sin preguntar: un acierto exacto va
   * derecho a la línea, una lista difusa espera que alguien elija.
   */
  exact: boolean;
  items: LookupItem[];
}

/**
 * F4-CART-01 — el orquestador de la cadena.
 *
 * Su trabajo entero es corto y por eso está bien que sea una clase aparte de
 * las strategies: recorre la lista, corre las que reconocen el texto, y **corta
 * en la primera exclusiva que acierta**. Nada más. Toda la inteligencia de qué
 * significa cada texto vive en las strategies, que se testean solas.
 */
@Injectable()
export class LookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbox: CashboxService,
  ) {}

  async search(user: AuthUser, scope: UserScope, query: LookupQuery): Promise<LookupResult> {
    // ── De qué almacén se pregunta ─────────────────────────────────────────
    //
    // El turno manda cuando existe: es el caso de la venta, y su almacén no se
    // discute. `warehouseId` explícito es para COTIZAR (F4-QUOTE-03), que no
    // exige caja y necesita otra forma de decir "desde acá".
    //
    // Sin ninguno de los dos, el 409: no es que no haya nada, es que no se
    // preguntó desde ningún lado, y devolver una lista vacía sería mentir.
    const sesion = await this.cashbox.current(user);
    const warehouseId = sesion?.warehouseId ?? query.warehouseId;
    if (warehouseId === undefined) {
      throw new ConflictException({ message: "pos.no_session" });
    }
    // Poder NOMBRAR un almacén no es poder consultarlo. El turno ya validó el
    // suyo al abrirse; el explícito se valida acá.
    // Las DOS guardas, no una: el alcance solo dice "de estos puedo", y para
    // un dueño es `all` — un uuid de otro tenant pasaría ese filtro y
    // devolvería un 200 con lista vacía, confirmando de paso que el
    // identificador tiene forma válida. `assertActiveWarehouse` es la que
    // contesta 404. Lo cazó el e2e "un `warehouseId` de otro tenant no existe
    // para este".
    if (sesion === null) {
      assertWarehouseInScope(scope, warehouseId);
      await this.prisma.withTenantContext(user.tenantId, (tx) =>
        assertActiveWarehouse(tx, user.tenantId, warehouseId),
      );
    }

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const ctx = {
        tx,
        tenantId: user.tenantId,
        warehouseId,
        q: query.q,
        limit: query.limit,
      };

      const items: LookupItem[] = [];
      for (const strategy of LOOKUP_STRATEGIES) {
        if (!strategy.matches(ctx.q)) {
          continue;
        }
        const encontrados = await strategy.run(ctx);
        if (encontrados.length === 0) {
          // Que una exclusiva NO acierte no corta la cadena: teclear un SKU
          // que no existe tiene que caer a la búsqueda por texto, no devolver
          // vacío. Corta el ACIERTO, no el intento.
          continue;
        }

        items.push(...encontrados);
        if (strategy.exclusive) {
          return { warehouseId, exact: true, items };
        }
      }

      return { warehouseId, exact: false, items: items.slice(0, ctx.limit) };
    });
  }
}
