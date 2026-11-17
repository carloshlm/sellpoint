import { addQuantities, getUnit } from "@sellpoint/shared";
import type { TicketRow } from "./ticket.renderer";

/** Lo que dice el pie del ticket cuando el negocio prende el conteo. */
export interface TicketCounts {
  /** Los renglones del ticket, de cualquier tipo. */
  lines: number;
  /** Lo que el cliente se lleva en la bolsa, contado como se vendió. */
  units: string;
  /** Servicios y conceptos, por su cantidad: no van en la bolsa. */
  services: string;
}

const ENTERO = /^\d+$/;

/**
 * Filas, unidades y servicios del ticket (Carlos, 2026-11-16).
 *
 * Un cliente pidió el número de piezas, y la pregunta fue qué contar cuando
 * la venta mezcla piezas, cajas, kilos y servicios. Lo decidido:
 *
 * - Un producto que se vende por cosas enteras suma su cantidad TAL COMO SE
 *   VENDIÓ: «4 piezas» suma 4 y «2 Caja ×12» suma 2 —dos cajas en la bolsa,
 *   no 24 piezas sueltas—. Cuenta como cosas enteras si la cantidad es entera
 *   y la unidad base es de conteo, o si la presentación es un paquete
 *   (factor ≠ 1, como «2 Bolsa 10Kg»).
 * - Lo de a granel suma 1 por renglón: 0.750 kg de jitomate es una bolsa.
 * - Servicios y conceptos (un flete, un anticipo, un estudio) van aparte.
 *
 * Las sumas van por `addQuantities` y no por `Number`, como en el carrito.
 */
export function contarTicket(rows: readonly TicketRow[]): TicketCounts {
  let units = "0";
  let services = "0";
  for (const row of rows) {
    if (row.kind !== "product") {
      services = addQuantities(services, row.quantity);
      continue;
    }
    units = addQuantities(units, sonCosasEnteras(row) ? row.quantity : "1");
  }
  return { lines: rows.length, units, services };
}

function sonCosasEnteras(row: TicketRow): boolean {
  const cantidad = addQuantities("0", row.quantity);
  if (!ENTERO.test(cantidad)) {
    return false;
  }
  const esPaquete = row.presentation != null && addQuantities("0", row.presentation.factor) !== "1";
  const seCuenta = row.baseUnit !== null && getUnit(row.baseUnit)?.category === "count";
  return esPaquete || seCuenta;
}
