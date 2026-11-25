/**
 * F10-BULK-03 — Escribir una cantidad en la unidad hermana de la base.
 *
 * El queso va en kilogramos (la unidad del precio), pero los 600 g sueltos se
 * escriben como 600, no como 0.600. La pantalla deja elegir la unidad junto a
 * la cantidad y la convierte a la base ANTES de mandarla: el API sigue
 * recibiendo la cantidad en la unidad de la presentación y no cambia.
 *
 * ── Por qué no sirve `convertUnits` ─────────────────────────────────────
 *
 * `convertUnits` usa coma flotante y está documentada como «solo para
 * mostrar»: 1.1 kg le dan 1100.0000000000002 g. Una cantidad que mueve
 * existencias no puede salir de ahí. Acá todo es aritmética de enteros
 * (`BigInt`) sobre fracciones exactas: el número tecleado y los `factor` de
 * `UNITS` se leen como decimales finitos y nunca pasan por `Number`.
 *
 * ── Solo donde el resultado cabe ────────────────────────────────────────
 *
 * La cantidad se guarda con `QUANTITY_SCALE` decimales. Una unidad se ofrece
 * solo si UNA de ella cabe en la base: de pies a pulgadas sí (1 ft = 12 in),
 * de pulgadas a pies no (1 in = 0.08333… ft). Y una cantidad concreta que no
 * cabe —0.05 g en una base de kilogramos— no se redondea: se rechaza, y la
 * pantalla dice cuál es la mínima.
 */

import type { Locale } from "./i18n";
import { QUANTITY_SCALE } from "./quantity";
import { isUnitCode, UNITS, type UnitCode, unitSymbol } from "./units";

/**
 * Las parejas de unidades hermanas, la mayor primero. Solo dice QUIÉN es
 * hermana de quién; cuánto vale una en la otra sale de los `factor` de
 * `UNITS`, que no se duplican aquí. Cada pareja se ofrece en cada dirección
 * solo si cabe (ver `captureUnitsFor`).
 *
 * El kilogramo y la libra son de la misma familia, pero no son hermanas: nadie
 * pesa queso en libras en una tienda que lo vende por kilo, y 1 lb = 0.45359237
 * kg tampoco cabría.
 */
const CAPTURE_PAIRS = [
  ["kg", "gr"],
  ["l", "ml"],
  ["m", "cm"],
  ["lb", "oz"],
  ["ft", "in"],
] as const satisfies readonly (readonly [UnitCode, UnitCode])[];

/** Una fracción exacta con denominador positivo. */
interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

const SCALE_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

/**
 * Un decimal escrito → fracción exacta: `"0.25"` → 25/100.
 *
 * Solo dígitos con a lo sumo un punto y un signo opcional, como
 * `scaledInteger`. `"600."` y `".5"` valen (son lo que hay en pantalla
 * mientras se teclea); `""`, `"."`, `"1,5"` y `"1e3"` no son números.
 */
function parseDecimal(value: string | number): Fraction | null {
  const text = (typeof value === "number" ? String(value) : value).trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (match === null) {
    return null;
  }
  const [, sign = "", integer = "", fraction = ""] = match;
  if (integer === "" && fraction === "") {
    return null;
  }
  const magnitude = BigInt(`${integer}${fraction}`);
  return { num: sign === "-" ? -magnitude : magnitude, den: 10n ** BigInt(fraction.length) };
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

function reduce(num: bigint, den: bigint): Fraction {
  const divisor = gcd(num, den);
  return divisor === 0n ? { num: 0n, den: 1n } : { num: num / divisor, den: den / divisor };
}

/** Cuántas veces divide `prime` a `value`, y lo que queda después. */
function stripFactor(value: bigint, prime: bigint): { count: number; rest: bigint } {
  let count = 0;
  let rest = value;
  while (rest % prime === 0n) {
    rest /= prime;
    count++;
  }
  return { count, rest };
}

/**
 * Fracción → decimal exacto, sin ceros de relleno (`"0.6"`, `"300"`), o `null`
 * si no es un decimal finito (1/12 = 0.08333…). Los ceros de la derecha no son
 * información, como en `addQuantities`.
 */
function formatFraction(value: Fraction): string | null {
  const { num, den } = reduce(value.num, value.den);
  const twos = stripFactor(den, 2n);
  const fives = stripFactor(twos.rest, 5n);
  if (fives.rest !== 1n) {
    return null;
  }
  const scale = Math.max(twos.count, fives.count);
  const scaled = (num * 10n ** BigInt(scale)) / den;
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  const body = fraction === "" ? integer : `${integer}.${fraction}`;
  return negative && body !== "0" ? `-${body}` : body;
}

/** ¿El valor se escribe con `QUANTITY_SCALE` decimales o menos? */
function fitsQuantityScale(value: Fraction): boolean {
  return (value.num * SCALE_FACTOR) % value.den === 0n;
}

/** Cuánto vale una `from` en `to`, exacto: el cociente de sus `factor`. */
function unitRatio(from: UnitCode, to: UnitCode): Fraction {
  const source = parseDecimal(UNITS[from].factor) as Fraction;
  const target = parseDecimal(UNITS[to].factor) as Fraction;
  return reduce(source.num * target.den, source.den * target.num);
}

/**
 * Las unidades en que se puede ESCRIBIR una cantidad de esta base, con la base
 * primero: `kg` → `["kg", "gr"]`, `gr` → `["gr", "kg"]`, `in` → `["in", "ft"]`.
 *
 * Una hermana entra solo si una de ella cabe en la base: por eso los pies no
 * ofrecen pulgadas. `unit` y las unidades sin hermana devuelven solo la base
 * (no hay botón que pintar); un código desconocido no ofrece nada.
 */
export function captureUnitsFor(baseUnit: string): UnitCode[] {
  if (!isUnitCode(baseUnit)) {
    return [];
  }
  const siblings = CAPTURE_PAIRS.flatMap(([bigger, smaller]): UnitCode[] => {
    if (bigger === baseUnit) return [smaller];
    if (smaller === baseUnit) return [bigger];
    return [];
  }).filter((sibling) => fitsQuantityScale(unitRatio(sibling, baseUnit)));
  return [baseUnit, ...siblings];
}

/** La pareja `(from, base)` solo vale si la base ofrece `from`. */
function captureRatio(from: string, base: string): Fraction | null {
  if (!isUnitCode(from) || !isUnitCode(base) || !captureUnitsFor(base).includes(from)) {
    return null;
  }
  return unitRatio(from, base);
}

/**
 * Lo tecleado en `from` → la cantidad en la unidad `base`, exacta y sin ceros
 * de relleno: `toBaseQuantity("600", "gr", "kg")` da `"0.6"`.
 *
 * Devuelve `null` si:
 * - el resultado no cabe en `QUANTITY_SCALE` decimales (0.05 g en kilogramos);
 * - lo tecleado no es un número (`""`, `"."`, `"1,5"`);
 * - la base no ofrece `from` (`captureUnitsFor`): otra familia, una unidad que
 *   no es su hermana o la dirección que no cabe (pulgadas en una base de pies).
 *
 * Con `from === base` solo normaliza: `"2.5000"` → `"2.5"`. El máximo de la
 * columna (`QUANTITY_MAX`) no se revisa aquí: lo revisa la validación de
 * cantidad de cada pantalla sobre el resultado.
 */
export function toBaseQuantity(typed: string, from: string, base: string): string | null {
  const ratio = captureRatio(from, base);
  const value = parseDecimal(typed);
  if (ratio === null || value === null) {
    return null;
  }
  const result = reduce(value.num * ratio.num, value.den * ratio.den);
  return fitsQuantityScale(result) ? formatFraction(result) : null;
}

/**
 * La inversa, para MOSTRAR: una cantidad guardada en `baseUnit` escrita en
 * `to` (`fromBaseQuantity("0.6000", "gr", "kg")` da `"600"`).
 *
 * No se limita a `QUANTITY_SCALE`: 0.0001 g son 0.0000001 kg, y eso es lo que
 * hay que mostrar. Devuelve `null` si el resultado no es un decimal exacto
 * (7 in = 0.58333… ft): quien lo pinta muestra la cantidad en la base.
 */
export function fromBaseQuantity(
  quantityBase: string | number,
  to: string,
  baseUnit: string,
): string | null {
  const ratio = captureRatio(to, baseUnit);
  const value = parseDecimal(quantityBase);
  if (ratio === null || value === null) {
    return null;
  }
  return formatFraction({ num: value.num * ratio.den, den: value.den * ratio.num });
}

/**
 * La pista junto a una cantidad menor que 1: «(600 g)» al lado de 0.600
 * kilogramos. Solo si la cantidad es mayor que cero y menor que 1 en la base y
 * su familia tiene una hermana MENOR (los gramos no tienen pista: su hermana
 * es el kilogramo). Si no aplica, `null`.
 *
 * El texto aprobado es el mismo en los dos idiomas: los símbolos de
 * `unitSymbol` no se traducen. `locale` está en la firma para que quien llama
 * no cambie el día que un símbolo sí se traduzca.
 */
export function captureHint(
  quantityBase: string | number,
  baseUnit: string,
  _locale: Locale,
): string | null {
  const value = parseDecimal(quantityBase);
  if (value === null || value.num <= 0n || value.num >= value.den) {
    return null;
  }
  const smaller = captureUnitsFor(baseUnit).find(
    (unit) => unit !== baseUnit && UNITS[unit].factor < UNITS[baseUnit as UnitCode].factor,
  );
  if (smaller === undefined) {
    return null;
  }
  const converted = fromBaseQuantity(quantityBase, smaller, baseUnit);
  return converted === null ? null : `(${converted} ${unitSymbol(smaller)})`;
}

/**
 * La cantidad más chica que se puede escribir en `from` y todavía cabe en la
 * base, para el mensaje «La cantidad mínima es {{min}}.»: en gramos con base
 * kilogramo es `"0.1"`; en la base misma, `"0.0001"`.
 *
 * Es el paso de la columna (una diezmilésima de la base) escrito en `from`,
 * ajustado para que sea un decimal finito: en pies con base pulgada, 0.0001 in
 * = 1/120000 ft no es finito, y la mínima es 0.000025 ft (0.0003 in).
 * `null` si la base no ofrece `from`.
 */
export function minimumCaptureQuantity(from: string, base: string): string | null {
  const ratio = captureRatio(from, base);
  if (ratio === null) {
    return null;
  }
  // El paso en `from`: (1 / 10^escala) ÷ ratio, reducido.
  const step = reduce(ratio.den, ratio.num * SCALE_FACTOR);
  // Lo que en el denominador no es 2 ni 5 se cancela con el múltiplo más chico
  // del paso que sí es un decimal finito.
  const rest = stripFactor(stripFactor(step.den, 2n).rest, 5n).rest;
  return formatFraction({ num: step.num * rest, den: step.den });
}
