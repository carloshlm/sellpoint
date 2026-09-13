import { hasValidQuantityScale, QUANTITY_MAX, quantityDecimals } from "@sellpoint/shared";

/**
 * ¿Qué le pasa a esta cantidad? Devuelve la CLAVE i18n del problema, o `null`
 * si no hay ninguno (Carlos, 2026-09-13).
 *
 * Gemelo de `moneyInputError` y por la misma razón: los problemas fallan por
 * motivos distintos, y decir «solo enteros» cuando lo que se escribió no es
 * un número manda al usuario a mirar el lugar equivocado.
 *
 * Trabaja sobre el texto crudo del `<input>`, no sobre un número, porque eso
 * es lo que hay mientras se escribe. Vacío no es error acá: cada pantalla
 * decide si su campo es obligatorio — en una compra una línea sin cantidad
 * es un borrador a medias, y eso lo dice el formulario, no este helper.
 */
export function quantityInputError(
  raw: string,
  options: { allowsDecimals: boolean },
): string | null {
  const texto = raw.trim();
  if (texto === "") {
    return null;
  }
  // La coma entra al teclear (ver `QuantityInput`), pero no es un número:
  // tiene su propio mensaje, o «3,5» se leería como un problema de decimales.
  if (texto.includes(",")) {
    return "purchaseOrders.lines.errors.quantityComma";
  }
  const cantidad = Number(texto);
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    return "purchaseOrders.lines.errors.quantityNaN";
  }
  if (cantidad > QUANTITY_MAX) {
    return "purchaseOrders.lines.errors.quantityTooLarge";
  }
  if (!options.allowsDecimals && !Number.isInteger(cantidad)) {
    return "purchaseOrders.lines.errors.quantityInteger";
  }
  return hasValidQuantityScale(cantidad) ? null : "purchaseOrders.lines.errors.quantityDecimals";
}

/**
 * ¿La línea admite fracciones? Manda la PRESENTACIÓN elegida; sin
 * presentación la cantidad va en unidad base, y ahí manda la categoría de la
 * unidad: `count` (pieza) no se parte, peso y volumen sí.
 *
 * El default con un producto todavía sin cargar es permisivo a propósito:
 * bloquear el punto por un dato que aún no llegó sería peor que dejarlo
 * pasar, porque el API rechaza igual y con el nombre de la presentación.
 */
export function lineaAdmiteDecimales(
  producto:
    | { baseUnit?: string; presentations: { id: string; allowFractionalInput: boolean }[] }
    | undefined,
  presentationId: string,
): boolean {
  if (producto === undefined) return true;
  const presentacion = producto.presentations.find((p) => p.id === presentationId);
  if (presentacion !== undefined) return presentacion.allowFractionalInput;
  return producto.baseUnit ? quantityDecimals(producto.baseUnit) > 0 : true;
}
