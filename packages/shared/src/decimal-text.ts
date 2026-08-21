/**
 * Aritmética decimal sobre TEXTO, sin coma flotante.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────
 *
 * Del lado del servidor todo número con decimales pasa por `Prisma.Decimal`.
 * Del lado del navegador no hay tal cosa, y los valores llegan como texto desde
 * columnas `numeric` — así que la tentación es hacer `Number(x) * Number(y)` y
 * seguir. Eso da `0.1 + 0.2 = 0.30000000000000004`, y en un punto de venta eso
 * se imprime.
 *
 * Lo que hay acá es la única pieza compartida: convertir un decimal escrito a
 * un ENTERO escalado. Con eso, sumar y multiplicar son operaciones de enteros y
 * el resultado no depende de IEEE-754.
 *
 * Vive aparte de `money` y de `quantity` porque las dos lo necesitan con
 * escalas distintas (2 y 4). Tenerlo dos veces sería garantizar que un día
 * uno acepte un formato que el otro rechaza.
 */

/**
 * Texto decimal → entero escalado.
 *
 * `"12.35"` con escala 2 da `1235`. `"0.250"` con escala 4 da `2500`.
 *
 * ── Los estados intermedios valen CERO, no NaN ──────────────────────────
 *
 * `""`, `"."` y `"12."` no son errores: son lo que hay en pantalla mientras
 * alguien teclea en el numpad. Devolver `NaN` haría parpadear el total del
 * carrito entero en cada pulsación, y peor, un `NaN` que llegue a un `JSON`
 * se serializa como `null` y termina en un 422 que nadie puede explicar
 * mirando la pantalla.
 *
 * ── Lo que no entra en la escala se CORTA ───────────────────────────────
 *
 * No se redondea, porque quien llama ya conoce la escala de su columna: un
 * tercer decimal en un precio no es un número que haya que aproximar, es un
 * dato que `DECIMAL(14,2)` tampoco va a guardar.
 */
export function scaledInteger(value: string | number | null | undefined, scale: number): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const texto = (typeof value === "number" ? String(value) : value).trim();
  // Solo dígitos con a lo sumo un punto. La segunda condición descarta lo que
  // pasa el primer filtro pero no tiene ni un dígito: `""`, `"."`, `"-"`.
  if (texto === "" || !/^-?\d*\.?\d*$/.test(texto) || /^-?\.?$/.test(texto)) {
    return 0;
  }

  const negativo = texto.startsWith("-");
  const [entero = "0", fraccion = ""] = (negativo ? texto.slice(1) : texto).split(".");
  const escalado = Number(`${entero || "0"}${fraccion.padEnd(scale, "0").slice(0, scale)}`);

  return negativo ? -escalado : escalado;
}
