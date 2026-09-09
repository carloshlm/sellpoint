/**
 * F4-DISC — el descuento en caja (Carlos, 2026-09-09).
 *
 * Es UN monto sobre el ticket que el cajero captura al cobrar, autorizado
 * con el PIN que el Admin define en Mi perfil. El servidor lo PRORRATEA
 * entre las líneas antes de calcular el impuesto: así el IVA se declara
 * sobre lo cobrado en los dos modos fiscales y `sales.discount` sigue siendo
 * la suma de los descuentos por línea, que es lo que el motor de totales ya
 * sabía hacer. El carrito usa la MISMA función para pintar el total, por la
 * misma razón que comparte `splitLineTax`: un total en pantalla y otro en el
 * papel es una discusión que en el mostrador no gana nadie.
 */

/** El PIN de autorización: de 4 a 8 dígitos, rápido de teclear frente al cliente. */
export const DISCOUNT_CODE_PATTERN = /^\d{4,8}$/;
export function isDiscountCode(value: string): boolean {
  return DISCOUNT_CODE_PATTERN.test(value);
}

/**
 * Reparte `totalCents` entre las líneas en proporción a su importe bruto,
 * en centavos exactos: primero la parte entera de cada una y después los
 * centavos que sobran, uno por uno, a las fracciones más grandes (empate: la
 * primera línea). Ninguna línea recibe más que su importe. Quien llama
 * garantiza `totalCents ≤ Σ weightsCents`; si no, el sobrante no se coloca.
 */
export function prorateDiscountCents(
  totalCents: number,
  weightsCents: readonly number[],
): number[] {
  const suma = weightsCents.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (totalCents <= 0 || suma <= 0) return weightsCents.map(() => 0);
  const exactas = weightsCents.map((w) => (totalCents * Math.max(0, w)) / suma);
  const partes = exactas.map((p) => Math.floor(p));
  let resto = totalCents - partes.reduce((acc, p) => acc + p, 0);
  const porFraccion = exactas
    .map((p, i) => ({ i, fraccion: p - Math.floor(p) }))
    .sort((a, b) => b.fraccion - a.fraccion || a.i - b.i);
  for (const { i } of porFraccion) {
    if (resto <= 0) break;
    if ((partes[i] as number) < (weightsCents[i] as number)) {
      partes[i] = (partes[i] as number) + 1;
      resto -= 1;
    }
  }
  return partes;
}

/** El máximo que admite el tope por ticket, en centavos; `null` = sin tope. */
export function discountCapCents(subtotalCents: number, maxPercent: number | null): number | null {
  if (maxPercent === null) return null;
  return Math.round((subtotalCents * maxPercent) / 100);
}
