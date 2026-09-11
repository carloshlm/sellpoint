import {
  grossUnitCostCents,
  netUnitCostCents,
  type TaxComponent,
  type TaxMode,
} from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";

/**
 * F9-COSTMODE-01 — el costo unitario en su base neta o bruta, en `Decimal`.
 *
 * La aritmética vive en shared, en centavos (`netUnitCostCents`); esto solo
 * traduce el `Decimal` de la columna a centavos y de vuelta, con el MISMO
 * corte a dos decimales que usa `armarTotales` (`pos/totals.ts`). Quien
 * computa dinero con un costo —la entrada al confirmar, la venta al
 * congelar— pasa por aquí y nunca divide por su cuenta.
 */
const centavos = (d: Prisma.Decimal): number => d.times(100).toDecimalPlaces(0).toNumber();
const desdeCentavos = (n: number): Prisma.Decimal => new Prisma.Decimal(n).dividedBy(100);

export function netUnitCost(
  amount: Prisma.Decimal,
  components: readonly TaxComponent[],
  mode: TaxMode,
): Prisma.Decimal {
  return desdeCentavos(netUnitCostCents(centavos(amount), components, mode));
}

export function grossUnitCost(
  amount: Prisma.Decimal,
  components: readonly TaxComponent[],
  mode: TaxMode,
): Prisma.Decimal {
  return desdeCentavos(grossUnitCostCents(centavos(amount), components, mode));
}
