import { Injectable } from "@nestjs/common";
import { type ModuleKey, type SaleAnnotation, saleAnnotationsSchema } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * F9-RECEP-23 — el PUNTO DE EXTENSIÓN de la venta (ley 31 de la Fase 9).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────
 *
 * Un cliente con Recepción vende la consulta en la caja y quiere que esa venta
 * genere el turno del paciente, con el número impreso en el ticket (Carlos,
 * 2026-10-21). La caja no puede saber qué es un turno: la ley 16 le prohíbe
 * importar un módulo vertical, porque el día que lo hiciera cada vertical
 * nuevo sería un `if` más en el núcleo. Así que el núcleo define el PUERTO y
 * el módulo se registra (inversión de dependencias): Recepción importa el
 * POS, nunca al revés. `no-vertical-imports.spec.ts` lo vigila.
 *
 * ── Las reglas del contrato ─────────────────────────────────────────────
 *
 * 1. Corren SOLO los ganchos de los módulos ACTIVOS del negocio
 *    (`entitlements.modules`): un negocio sin Recepción no hace ni una consulta
 *    más que antes.
 * 2. Corren DENTRO de la transacción de la venta, después del ledger. Un gancho
 *    que falla la deshace entera: no hay dinero sin turno ni turno sin dinero.
 * 3. Lo único que un gancho le devuelve a la caja son ANOTACIONES genéricas
 *    (`labelKey` + valor). La caja las valida, las guarda en
 *    `sales.annotations` y las imprime en el ticket; no sabe qué significan.
 * 4. La reintentada idempotente devuelve la venta guardada sin volver a correr
 *    nada: los ganchos solo corren cuando la venta NACE.
 */

/** Una línea de la venta, como la ve un gancho. La cantidad viaja como texto decimal. */
export interface SaleHookItem {
  lineNo: number;
  kind: string;
  productId: string | null;
  serviceId: string | null;
  quantity: string;
}

/** Lo que la caja sabe de la venta recién creada, y la transacción para escribir en ella. */
export interface SaleHookContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
  userId: string;
  /** La zona del NEGOCIO: el «día» de quien reaccione (el turno reinicia con él). */
  timeZone: string;
  sale: { id: string; folio: string; createdAt: Date; warehouseId: string };
  items: SaleHookItem[];
}

/** El puerto. Un módulo vertical lo implementa y se registra en `onModuleInit`. */
export interface SaleHook {
  readonly sourceModule: ModuleKey;
  afterSale(ctx: SaleHookContext): Promise<SaleAnnotation[]>;
}

/**
 * Dónde se registran los ganchos. Uno por módulo: dos registros del mismo
 * serían, por ejemplo, dos turnos por cada consulta vendida.
 */
@Injectable()
export class SaleHooksRegistry {
  private readonly hooks: SaleHook[] = [];

  register(hook: SaleHook): void {
    if (this.hooks.some((h) => h.sourceModule === hook.sourceModule)) {
      throw new Error(`el módulo ${hook.sourceModule} ya registró su gancho de venta`);
    }
    this.hooks.push(hook);
  }

  /** Los de los módulos activos del negocio, en orden de registro. */
  activeFor(modules: readonly ModuleKey[]): readonly SaleHook[] {
    return this.hooks.filter((h) => modules.includes(h.sourceModule));
  }
}

/**
 * Corre los ganchos en orden y devuelve sus anotaciones VALIDADAS. Cualquier
 * error sube tal cual —el de un gancho o el de una anotación inválida— para
 * que la transacción de la venta se deshaga: una anotación mal formada es un
 * bug del módulo, y la caja no imprime basura.
 */
export async function runSaleHooks(
  hooks: readonly SaleHook[],
  ctx: SaleHookContext,
): Promise<SaleAnnotation[]> {
  const anotaciones: SaleAnnotation[] = [];
  for (const hook of hooks) {
    const propias = await hook.afterSale(ctx);
    for (const anotacion of propias) {
      if (anotacion.sourceModule !== hook.sourceModule) {
        throw new Error(
          `el gancho de ${hook.sourceModule} firmó una anotación como ${anotacion.sourceModule}`,
        );
      }
    }
    anotaciones.push(...propias);
  }
  return saleAnnotationsSchema.parse(anotaciones);
}
