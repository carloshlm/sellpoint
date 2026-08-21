import { scaledInteger } from "./decimal-text";
import { getUnit } from "./units";

/**
 * Cuántos decimales corresponden a cada categoría de unidad.
 *
 * **La precisión es una propiedad de lo que se MIDE, no del número que salió
 * hoy.** Un producto que se cuenta en piezas no puede tener medias piezas, así
 * que sus decimales son siempre cero: pintarlos es agregar cuatro dígitos que
 * no pueden significar nada. Uno que se pesa sí puede tener 0.250, y ahí los
 * decimales llevan información.
 *
 * La alternativa —recortar los ceros de cada valor por separado— parece más
 * simple y es peor: un kardex se lee EN VERTICAL, y con decimales variables la
 * columna queda `262`, `250.5`, `280`, `1.25` y el ojo ya no puede comparar
 * magnitudes de un vistazo. Los libros de inventario usan decimales fijos por
 * esa razón.
 */
const DECIMALES_POR_CATEGORIA = {
  count: 0,
  weight: 3,
  volume: 3,
  length: 3,
} as const;

/** Los decimales que le tocan a esta unidad base. */
export function quantityDecimals(baseUnit: string): number {
  const unidad = getUnit(baseUnit);
  // Una unidad desconocida —un producto viejo con un código que ya no está en
  // el catálogo— se trata como continua: mostrar de más nunca oculta nada.
  return unidad === undefined ? 3 : DECIMALES_POR_CATEGORIA[unidad.category];
}

/**
 * Formatea una cantidad para MOSTRARLA, según la unidad que la mide.
 *
 * ── La válvula de seguridad ─────────────────────────────────────────────
 *
 * Si el valor trae decimales que NO caben en la precisión de su unidad, se
 * muestran igual. Un `262.5` en piezas es un dato imposible —una importación
 * torcida, un bug, una migración a medias— y redondearlo a `263` lo
 * **escondería**. En un libro de inventario, un formato que tapa una
 * inconsistencia es peor que uno feo: el número raro TIENE que verse raro.
 *
 * ── Por qué aritmética de strings y no `Number` ──────────────────────────
 *
 * Es la misma razón por la que el ledger entero usa `Prisma.Decimal`: los
 * valores llegan como texto desde `numeric(_,4)` y pasarlos por coma flotante
 * para volver a texto puede correr un dígito. Acá no hay cuentas que hacer,
 * solo mirar dónde está el punto — así que no se hacen.
 */
export function formatQuantity(value: string | number, baseUnit: string): string {
  const texto = typeof value === "number" ? String(value) : value.trim();
  if (texto === "") {
    return "";
  }

  const negativo = texto.startsWith("-");
  const sinSigno = negativo ? texto.slice(1) : texto;
  const [entero = "0", fraccion = ""] = sinSigno.split(".");

  const decimales = quantityDecimals(baseUnit);
  // Los ceros de la derecha no son información: `2.5000` y `2.5` son el mismo
  // peso. Lo que importa es cuántos dígitos SIGNIFICATIVOS hay.
  const significativa = fraccion.replace(/0+$/, "");

  const cuerpo =
    significativa.length > decimales
      ? `${entero}.${significativa}`
      : decimales === 0
        ? entero
        : `${entero}.${significativa.padEnd(decimales, "0")}`;

  return negativo ? `-${cuerpo}` : cuerpo;
}

/** Los decimales que admite una cantidad en la base: `DECIMAL(14,4)`. */
export const QUANTITY_SCALE = 4;

/**
 * F4-CART-02 — suma dos cantidades escritas como texto.
 *
 * Escanear dos veces el mismo código suma sobre el renglón que ya está, y esa
 * suma no puede pasar por `Number`: `0.1 + 0.2` da `0.30000000000000004`, que
 * en un producto que se pesa es una cantidad imposible impresa en el ticket.
 * Se suma en enteros y se vuelve a texto.
 */
export function addQuantities(a: string | number, b: string | number): string {
  const total = scaledInteger(a, QUANTITY_SCALE) + scaledInteger(b, QUANTITY_SCALE);
  const negativo = total < 0;
  const absoluto = String(Math.abs(total)).padStart(QUANTITY_SCALE + 1, "0");

  const entero = absoluto.slice(0, -QUANTITY_SCALE);
  // Los ceros de la derecha no son información: `2.5000` y `2.5` son la misma
  // cantidad. Los significativos, sí.
  const fraccion = absoluto.slice(-QUANTITY_SCALE).replace(/0+$/, "");
  const cuerpo = fraccion === "" ? entero : `${entero}.${fraccion}`;

  return negativo ? `-${cuerpo}` : cuerpo;
}

/**
 * El texto del numpad → el número que viaja en el POST.
 *
 * **Un solo lugar donde ocurre la conversión.** Devuelve `0` en vez de `NaN`
 * ante un estado intermedio, y eso importa por lo que pasa después: un `NaN`
 * en el cuerpo del cobro se serializa a `null` en JSON, y el API contesta un
 * 422 sobre un campo faltante que nadie va a poder explicar mirando la
 * pantalla.
 */
export function parseQuantity(value: string | number): number {
  return scaledInteger(value, QUANTITY_SCALE) / 10 ** QUANTITY_SCALE;
}
