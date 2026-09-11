import { z } from "zod";

/**
 * F9-PURCH-01 — los contratos de Compras.
 *
 * Una compra nace BORRADOR (se captura línea por línea), se CONFIRMA (queda
 * sellada y recién entonces puede ingresar al inventario) y puede ANULARSE.
 * No se borra nunca: la entrada de inventario la apunta por un par opaco sin
 * FK, y una compra borrada dejaría ese puntero al vacío.
 */
export const PURCHASE_STATUSES = ["draft", "confirmed", "canceled"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const purchaseStatusSchema = z.enum(PURCHASE_STATUSES);

/**
 * El modo fiscal es POR DOCUMENTO (compra u orden) y NACE del ajuste del
 * negocio «los costos se capturan con o sin impuesto» (`tenants.cost_tax_mode`,
 * F9-COSTMODE-04) — no del modo del PRECIO (`tax_mode`), que responde otra
 * pregunta: el mostrador mexicano vende con IVA adentro y compra con IVA
 * aparte. Sigue editable por documento porque una factura concreta puede
 * venir en la otra base. Ya no hay default hardcodeado aquí: lo decide el
 * negocio, y por país lo siembra `tax-defaults.ts#costModeFor`.
 */
export const PURCHASE_TAX_MODES = ["included", "excluded"] as const;
export type PurchaseTaxMode = (typeof PURCHASE_TAX_MODES)[number];
export const purchaseTaxModeSchema = z.enum(PURCHASE_TAX_MODES);

export interface TotalMismatch {
  /** El papel del proveedor dice OTRA cosa que la suma de las líneas. */
  mismatch: boolean;
  /** `declarado − calculado`, con signo; `null` cuando no hay descuadre o no hay declarado. */
  difference: string | null;
}

/** Un decimal en texto → entero escalado a `escala` decimales. `null` si no es un decimal. */
function aEnteroEscalado(valor: string, escala: number): bigint | null {
  const limpio = valor.trim();
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) {
    return null;
  }
  const negativo = limpio.startsWith("-");
  const [entero = "0", decimales = ""] = limpio.replace("-", "").split(".");
  const relleno = decimales.padEnd(escala, "0").slice(0, escala);
  const magnitud = BigInt(`${entero}${relleno}`);
  return negativo ? -magnitud : magnitud;
}

/** Cuántos decimales tiene un decimal en texto. */
function decimalesDe(valor: string): number {
  return valor.trim().split(".")[1]?.length ?? 0;
}

/** El entero escalado, de vuelta a texto decimal con su escala. */
function aTexto(valor: bigint, escala: number): string {
  if (escala === 0) {
    return valor.toString();
  }
  const negativo = valor < 0n;
  const digitos = (negativo ? -valor : valor).toString().padStart(escala + 1, "0");
  const entero = digitos.slice(0, digitos.length - escala);
  const decimales = digitos.slice(digitos.length - escala);
  return `${negativo ? "-" : ""}${entero}.${decimales}`;
}

/**
 * F9-PURCH-01 — ¿el total que dice el PAPEL coincide con la suma de las
 * líneas capturadas?
 *
 * Se DERIVA, nunca se guarda: `declared_total` es lo que el proveedor
 * imprimió y `total` lo que se capturó, y la diferencia es una consecuencia
 * de los dos. Guardarla obligaría a recalcularla en cada edición de línea y
 * dejaría una tercera versión de la verdad.
 *
 * **Nunca bloquea** (Carlos, 2026-09-10): avisa en el detalle, el listado y el
 * PDF, y la compra se confirma igual. Ajustar las líneas para que cuadren
 * pisaría el costo del catálogo con un número inventado.
 *
 * La comparación es DECIMAL, no `Number`: «100.10» y «100.1» son el mismo
 * importe, y en punto flotante `0.1 + 0.2 !== 0.3` deja descuadres fantasma
 * de un centavo en facturas largas.
 */
export function totalMismatch(declared: string | null | undefined, total: string): TotalMismatch {
  const sinDescuadre: TotalMismatch = { mismatch: false, difference: null };
  if (declared === null || declared === undefined || declared.trim() === "") {
    return sinDescuadre;
  }
  const escala = Math.max(decimalesDe(declared), decimalesDe(total));
  const izquierdo = aEnteroEscalado(declared, escala);
  const derecho = aEnteroEscalado(total, escala);
  if (izquierdo === null || derecho === null || izquierdo === derecho) {
    return sinDescuadre;
  }
  return { mismatch: true, difference: aTexto(izquierdo - derecho, escala) };
}
