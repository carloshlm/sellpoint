import {
  formatMoneyInput,
  hasValidMoneyScale,
  MONEY_MAX,
  parseMoneyInput,
} from "@sellpoint/shared";

/**
 * ¿Qué le pasa a este importe? Devuelve la CLAVE i18n del problema, o `null` si
 * no hay ninguno.
 *
 * Devuelve la clave y no un booleano porque los tres problemas fallan por
 * motivos distintos: decir "admite 2 decimales" cuando lo que no entra es la
 * magnitud —o cuando lo que se escribió es una coma— manda al usuario a mirar
 * el lugar equivocado.
 *
 * Trabaja sobre el string crudo del `<input>`, no sobre un número, porque eso
 * es lo que hay mientras se escribe. Vacío NO es error: el campo es opcional.
 * Y desde que el campo es de texto (`inputMode="decimal"`), lo que no es un
 * importe SÍ es error del formulario: ya no hay un `type="number"` que lo
 * frene antes.
 */
export function moneyInputError(raw: string): string | null {
  if (raw.trim() === "") {
    return null;
  }
  const amount = parseMoneyInput(raw);
  if (amount === null) {
    return "products.invalid_amount";
  }
  if (amount > MONEY_MAX) {
    return "products.amount_too_large";
  }
  return hasValidMoneyScale(amount) ? null : "products.too_many_decimals";
}

/**
 * El texto con el que ARRANCA un campo de importe al abrir un registro
 * guardado. El API devuelve `Prisma.Decimal.toString()`, que no rellena ceros
 * (`"45"`, `"0.5"`): si el campo promete dos decimales, tiene que cumplirlo
 * también al cargar y no solo después de que el usuario lo toque. Lo que no se
 * puede formatear —`null`, vacío— arranca vacío.
 */
export function moneyInitialValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return formatMoneyInput(value) ?? value;
}

/**
 * ¿Estos dos textos son el MISMO importe? «6», «6.00» y « 6.0 » lo son; el
 * campo vacío solo es igual a otro vacío.
 *
 * Existe porque un campo que se autoguarda compara lo tecleado contra lo
 * guardado para decidir si hay algo que mandar, y desde que los importes se
 * formatean al salir del campo, el TEXTO cambia sin que el importe cambie.
 * Comparar cadenas ahí guardaría al abrir la pantalla y otra vez tras cada
 * respuesta del API, que devuelve el decimal sin ceros de relleno.
 *
 * Vacío y cero NO son lo mismo, a propósito: vacío es «sin capturar» y cero
 * es «me cuesta $0» — la distinción que el hint del producto ya explica.
 */
export function mismoImporte(a: string, b: string | null | undefined): boolean {
  const izquierdo = a.trim();
  const derecho = (b ?? "").trim();
  if (izquierdo === "" || derecho === "") {
    return izquierdo === derecho;
  }
  return Number(izquierdo) === Number(derecho);
}
