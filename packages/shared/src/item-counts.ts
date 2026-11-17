import type { PosLineKind } from "./pos-lines";
import { addQuantities } from "./quantity";
import { getUnit } from "./units";

/** Lo que el conteo necesita de un renglón, venga del ticket o del carrito. */
export interface ItemCountLine {
  kind: PosLineKind;
  /** La cantidad TAL COMO SE VENDIÓ: en la presentación elegida. */
  quantity: string;
  /** La unidad base del producto; `null` en servicios y conceptos. */
  baseUnit: string | null;
  /** El factor de la presentación vendida; `null` o «1» si es la base. */
  factor: string | null;
}

/** Filas, unidades y servicios de una venta o una cotización. */
export interface ItemCounts {
  /** Los renglones, de cualquier tipo. */
  lines: number;
  /** Lo que el cliente se lleva en la bolsa, contado como se vendió. */
  units: string;
  /** Servicios y conceptos, por su cantidad: no van en la bolsa. */
  services: string;
}

const ENTERO = /^\d+$/;

/**
 * Filas, unidades y servicios (Carlos, 2026-11-16). Lo imprime el ticket si el
 * negocio lo prende, y lo muestra el panel de cobro: la misma regla en los dos.
 *
 * Un cliente pidió el número de piezas, y la pregunta fue qué contar cuando la
 * venta mezcla piezas, cajas, kilos y servicios. Lo decidido:
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
export function countItems(lines: readonly ItemCountLine[]): ItemCounts {
  let units = "0";
  let services = "0";
  for (const line of lines) {
    if (line.kind !== "product") {
      services = addQuantities(services, line.quantity);
      continue;
    }
    units = addQuantities(units, sonCosasEnteras(line) ? line.quantity : "1");
  }
  return { lines: lines.length, units, services };
}

function sonCosasEnteras(line: ItemCountLine): boolean {
  if (!ENTERO.test(addQuantities("0", line.quantity))) {
    return false;
  }
  const esPaquete = line.factor !== null && addQuantities("0", line.factor) !== "1";
  const seCuenta = line.baseUnit !== null && getUnit(line.baseUnit)?.category === "count";
  return esPaquete || seCuenta;
}
