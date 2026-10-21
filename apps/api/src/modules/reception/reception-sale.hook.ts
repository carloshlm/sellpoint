import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SALE_ANNOTATIONS_MAX, type SaleAnnotation } from "@sellpoint/shared";
import { AuditService } from "../audit/audit.service";
import { type SaleHook, type SaleHookContext, SaleHooksRegistry } from "../pos/sale-hooks";
import { TurnsService } from "./turns.service";

/**
 * Cuántos turnos puede generar una venta. Es el MISMO tope de las anotaciones
 * que la caja acepta en una venta: un turno es una anotación, y si el gancho
 * devolviera más, la validación del POS desharía la venta entera.
 */
export const TURNOS_POR_VENTA_MAX = SALE_ANNOTATIONS_MAX;

/**
 * Cuántos turnos pide una línea: uno por unidad entera, nunca menos de uno (si
 * se vendió, se atiende) y nunca más que el tope. La cantidad llega como texto
 * decimal (`"2.0000"`).
 */
export function turnosDeLinea(quantity: string): number {
  const enteras = Math.floor(Number(quantity));
  if (!Number.isFinite(enteras)) {
    return 1;
  }
  return Math.min(TURNOS_POR_VENTA_MAX, Math.max(1, enteras));
}

/**
 * F9-RECEP-26 — el gancho de Recepción en la venta (ley 31; Carlos,
 * 2026-10-21): vender un servicio MARCADO en «Configuración Recepción» crea el
 * turno del paciente, en la misma transacción de la venta.
 *
 * - Lo registra el MÓDULO en el punto de extensión del POS: el POS no importa
 *   Recepción (ley 16). Y solo corre si el negocio tiene Recepción activo.
 * - Sin servicios marcados entre los vendidos, no crea nada: los negocios que
 *   solo usan «Generar turno» no notan nada.
 * - Un turno por unidad, del MISMO instante —el de la venta—, ligado a ella
 *   (`sale_id`), sin paciente: el Consultorio lo liga al atender, como ya hace
 *   con un turno suelto.
 * - Le devuelve a la caja una anotación enfática por turno («Turno: 7»), que
 *   el ticket imprime en grande.
 */
@Injectable()
export class ReceptionSaleHook implements SaleHook, OnModuleInit {
  readonly sourceModule = "reception" as const;

  constructor(
    private readonly registry: SaleHooksRegistry,
    private readonly turns: TurnsService,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async afterSale(ctx: SaleHookContext): Promise<SaleAnnotation[]> {
    const vendidos = [
      ...new Set(
        ctx.items.flatMap((item) =>
          item.kind === "service" && item.serviceId !== null ? [item.serviceId] : [],
        ),
      ),
    ];
    if (vendidos.length === 0) {
      return [];
    }
    const marcados = await ctx.tx.receptionTurnService.findMany({
      where: { tenantId: ctx.tenantId, serviceId: { in: vendidos } },
      select: { serviceId: true },
    });
    if (marcados.length === 0) {
      return [];
    }
    const generanTurno = new Set(marcados.map((m) => m.serviceId));

    const anotaciones: SaleAnnotation[] = [];
    for (const item of ctx.items) {
      if (item.serviceId === null || !generanTurno.has(item.serviceId)) {
        continue;
      }
      const pedidos = turnosDeLinea(item.quantity);
      for (let i = 0; i < pedidos && anotaciones.length < TURNOS_POR_VENTA_MAX; i++) {
        const { turno, fechaLocal } = await this.turns.createIn(ctx.tx, {
          tenantId: ctx.tenantId,
          timeZone: ctx.timeZone,
          // UN instante para toda la venta (ley 12): el de la venta misma.
          instant: ctx.sale.createdAt,
          customerId: null,
          customerName: null,
          saleId: ctx.sale.id,
          createdBy: ctx.userId,
        });
        await this.auditService.record(ctx.tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          action: "reception.turn.create",
          resourceType: "reception_turn",
          resourceId: turno.id,
          after: {
            number: turno.number,
            businessDate: fechaLocal,
            customerId: null,
            source: "sale",
            saleFolio: ctx.sale.folio,
          },
        });
        anotaciones.push({
          sourceModule: "reception",
          labelKey: "reception.saleAnnotation.turn",
          value: String(turno.number),
          emphasis: true,
        });
      }
    }
    return anotaciones;
  }
}
