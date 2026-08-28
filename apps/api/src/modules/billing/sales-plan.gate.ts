import { Injectable } from "@nestjs/common";
import { endOfDayUtc, localCalendarDate, startOfDayUtc } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PlanRequiredException } from "./plan-required.exception";

/**
 * F7-POS-04 — el límite de ventas diarias del free tier.
 *
 * Vive como servicio y NO en el SubscriptionGuard: contar exige la zona
 * horaria del negocio y correr DENTRO de la transacción de la venta, ANTES
 * de gastar folio — un rechazo no consume numeración. El "hoy" es el día
 * del NEGOCIO (la lección del Kardex), y las canceladas no cuentan: cancelar
 * una venta devuelve el cupo.
 *
 * La carrera (dos ventas simultáneas leyendo 9 y 9) puede regalar UNA venta
 * de más un día: para un tier gratuito de 10, un off-by-one no es riesgo de
 * negocio — documentado y aceptado (refinamiento exacto disponible vía
 * nextSequenceValue si algún día molesta).
 */
@Injectable()
export class SalesPlanGate {
  async assertDailySaleAllowed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dailySalesLimit: number | null,
    timeZone: string,
    now: Date,
  ): Promise<void> {
    if (dailySalesLimit === null) {
      // Camino caliente de los planes de pago: cero queries.
      return;
    }

    const hoy = localCalendarDate(timeZone, now);
    const vendidasHoy = await tx.sale.count({
      where: {
        tenantId,
        createdAt: { gte: startOfDayUtc(hoy, timeZone), lt: endOfDayUtc(hoy, timeZone) },
        canceledAt: null,
      },
    });

    if (vendidasHoy >= dailySalesLimit) {
      throw new PlanRequiredException("billing.daily_sales_limit_reached", {
        limit: dailySalesLimit,
      });
    }
  }
}
