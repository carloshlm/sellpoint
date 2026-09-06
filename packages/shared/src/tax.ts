import { z } from "zod";

/**
 * F4-TAX-02 — la aritmética del impuesto de venta, pura y en enteros.
 *
 * ── Por qué vive en `shared` ────────────────────────────────────────────
 *
 * La usan el API (que convierte `Prisma.Decimal` a centavos y de vuelta) y el
 * carrito del web (que ya suma centavos redondeados por línea). Si cada lado
 * dividiera por su cuenta, el cajero vería un total y el papel imprimiría
 * otro, con un centavo de diferencia que nadie puede explicar en el
 * mostrador. UNA función, probada una vez, usada dos veces.
 *
 * ── Por qué `bigint` ────────────────────────────────────────────────────
 *
 * La tasa se escala a diezmilésimas de por ciento (`TAX_RATE_SCALE = 4`:
 * 16% → 160000, 9.975% → 99750) y el importe va en centavos. Multiplicar
 * `MONEY_MAX` en centavos (10¹⁴) por la tasa escalada supera
 * `Number.MAX_SAFE_INTEGER` (≈ 9 × 10¹⁵): con `number` el redondeo sería
 * silencioso. Con `bigint` no hay pregunta; se devuelve `number` de centavos
 * porque ahí sí cabe.
 *
 * ── Dos modos, dos fórmulas ─────────────────────────────────────────────
 *
 * - `excluded` (Canadá, EE. UU.): el importe ES la base; cada componente se
 *   calcula sobre ella y se suma.
 * - `included` (México, la UE): el importe es el TOTAL; la base sale de
 *   dividir por (1 + Σ tasas) y el impuesto es la resta. Se reparte por
 *   componente en proporción a su tasa y el ÚLTIMO absorbe el residuo del
 *   redondeo, así `Σ byComponent` es EXACTAMENTE el impuesto: el papel cuadra
 *   siempre.
 *
 * Half-up en todos los cortes (medio centavo sube), que es lo que SAT y CRA
 * aceptan por línea. Sin impuestos compuestos: ningún mercado objetivo los
 * usa (el QST dejó de serlo en 2013).
 */
export const TAX_MODES = ["included", "excluded"] as const;
export type TaxMode = (typeof TAX_MODES)[number];
export const taxModeSchema = z.enum(TAX_MODES);

/** Decimales de la tasa: 9.975 (QST) exige cuatro. */
export const TAX_RATE_SCALE = 4;
export const TAX_RATE_MAX = 100;
/** Tope duro de componentes por grupo: ningún mercado objetivo pasa de dos. */
export const MAX_TAX_COMPONENTS = 4;

/** Un componente del impuesto de un artículo: «GST 5%», «PST 7%», «IVA 16%». */
export interface TaxComponent {
  code: string;
  name: string;
  /** Porcentaje como texto decimal, hasta `TAX_RATE_SCALE` decimales. */
  rate: string;
}

export interface TaxSplit {
  netCents: number;
  taxCents: number;
  byComponent: { code: string; taxCents: number }[];
}

const RATE_DIVISOR = 10n ** BigInt(TAX_RATE_SCALE + 2); // 10⁶: porcentaje escalado → fracción

/**
 * La tasa a entero escalado: `"16"` → `160000n`, `"9.975"` → `99750n`.
 * Rechaza lo que no es una tasa: negativos, más de cuatro decimales, más de 100.
 */
export function rateToScaled(rate: string): bigint {
  const texto = rate.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(texto)) {
    throw new RangeError(
      `tax rate must be a decimal with up to ${TAX_RATE_SCALE} decimals: "${rate}"`,
    );
  }
  const [entero, fraccion = ""] = texto.split(".");
  const escalado = BigInt(`${entero}${fraccion.padEnd(TAX_RATE_SCALE, "0")}`);
  if (escalado > BigInt(TAX_RATE_MAX) * 10n ** BigInt(TAX_RATE_SCALE)) {
    throw new RangeError(`tax rate above ${TAX_RATE_MAX}%: "${rate}"`);
  }
  return escalado;
}

/** División entera con medio hacia arriba, para no negativos. */
function halfUp(numerador: bigint, denominador: bigint): bigint {
  return (numerador * 2n + denominador) / (denominador * 2n);
}

export function splitLineTax(input: {
  amountCents: number;
  mode: TaxMode;
  components: readonly TaxComponent[];
}): TaxSplit {
  const { amountCents, mode, components } = input;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError(`amountCents must be a non-negative integer: ${amountCents}`);
  }
  if (components.length > MAX_TAX_COMPONENTS) {
    throw new RangeError(`at most ${MAX_TAX_COMPONENTS} tax components per line`);
  }
  const tasas = components.map((c) => rateToScaled(c.rate));
  const total = tasas.reduce((acc, r) => acc + r, 0n);
  const importe = BigInt(amountCents);

  if (components.length === 0 || total === 0n) {
    return {
      netCents: amountCents,
      taxCents: 0,
      byComponent: components.map((c) => ({ code: c.code, taxCents: 0 })),
    };
  }

  if (mode === "excluded") {
    const porComponente = tasas.map((r) => halfUp(importe * r, RATE_DIVISOR));
    const impuesto = porComponente.reduce((acc, t) => acc + t, 0n);
    return {
      netCents: amountCents,
      taxCents: Number(impuesto),
      byComponent: components.map((c, i) => ({ code: c.code, taxCents: Number(porComponente[i]) })),
    };
  }

  // included: base = importe / (1 + Σ tasas), impuesto = importe − base.
  const base = halfUp(importe * RATE_DIVISOR, RATE_DIVISOR + total);
  const impuesto = importe - base;
  const porComponente: bigint[] = [];
  let repartido = 0n;
  tasas.forEach((r, i) => {
    // El último se lleva lo que falta: la suma cuadra por construcción.
    const parte = i === tasas.length - 1 ? impuesto - repartido : halfUp(impuesto * r, total);
    porComponente.push(parte);
    repartido += parte;
  });
  return {
    netCents: Number(base),
    taxCents: Number(impuesto),
    byComponent: components.map((c, i) => ({ code: c.code, taxCents: Number(porComponente[i]) })),
  };
}
