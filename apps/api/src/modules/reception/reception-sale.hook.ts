import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { SaleAnnotation } from "@sellpoint/shared";
import { AuditService } from "../audit/audit.service";
import { type SaleHook, type SaleHookContext, SaleHooksRegistry } from "../pos/sale-hooks";
import { TurnsService } from "./turns.service";

/**
 * F9-RECEP-26 — el gancho de Recepción en la venta (ley 31; Carlos,
 * 2026-10-21): vender un servicio MARCADO en «Configuración Recepción» crea el
 * turno del paciente, en la misma transacción de la venta.
 *
 * - Lo registra el MÓDULO en el punto de extensión del POS: el POS no importa
 *   Recepción (ley 16). Y solo corre si el negocio tiene Recepción activo.
 * - Sin servicios marcados entre los vendidos, no crea nada: los negocios que
 *   solo usan «Generar turno» no notan nada.
 * - F9-RECEP-31 — UNA venta es UN turno, aunque lleve varios servicios
 *   marcados o varias unidades (Carlos, 2026-10-21: «salen 2 turnos en un
 *   ticket y eso está mal»). Quien paga es un paciente con un número; si
 *   vienen dos, son dos ventas, o el segundo sale de «Generar turno».
 * - El turno es del MISMO instante que la venta, va ligado a ella (`sale_id`)
 *   y nace sin paciente: el Consultorio lo liga al atender, como ya hace con
 *   un turno suelto.
 * - Le devuelve a la caja una anotación enfática («Turno: 7»), que el ticket
 *   imprime en grande.
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
    // Basta con saber si ALGUNO de los vendidos genera turno: el turno es de
    // la venta, no de cada servicio.
    const marcado = await ctx.tx.receptionTurnService.findFirst({
      where: { tenantId: ctx.tenantId, serviceId: { in: vendidos } },
      select: { serviceId: true },
    });
    if (marcado === null) {
      return [];
    }

    const { turno, fechaLocal } = await this.turns.createIn(ctx.tx, {
      tenantId: ctx.tenantId,
      timeZone: ctx.timeZone,
      // El instante de la venta misma (ley 12): el día del turno es el suyo.
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
    return [
      {
        sourceModule: "reception",
        labelKey: "reception.saleAnnotation.turn",
        value: String(turno.number),
        emphasis: true,
      },
    ];
  }
}
