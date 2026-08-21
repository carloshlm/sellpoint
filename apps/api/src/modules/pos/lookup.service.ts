import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
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

  async search(user: AuthUser, query: LookupQuery): Promise<LookupResult> {
    const sesion = await this.cashbox.current(user);
    if (sesion === null) {
      // El mismo 409 que el cobro, y por el mismo motivo: sin turno no hay
      // almacén contra el cual resolver disponibilidad. Devolver una lista
      // vacía sería mentir — no es que no haya nada, es que no se preguntó
      // desde ningún lado.
      throw new ConflictException({ message: "pos.no_session" });
    }

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const ctx = {
        tx,
        tenantId: user.tenantId,
        warehouseId: sesion.warehouseId,
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
          return { warehouseId: sesion.warehouseId, exact: true, items };
        }
      }

      return { warehouseId: sesion.warehouseId, exact: false, items: items.slice(0, ctx.limit) };
    });
  }
}
