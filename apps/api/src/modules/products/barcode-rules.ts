import { BadRequestException } from "@nestjs/common";
import { classifyGtin, isScannableBarcode, isValidBarcode } from "@sellpoint/shared";
import type { z } from "zod";
import type { BarcodeContribution } from "./barcode-contribution.service";

/**
 * Carlos (2026-10-30) — las reglas del código de barras de un producto, en UN
 * lugar para las cinco puertas que lo guardan: alta y edición del producto,
 * alta y edición de una presentación, y la importación (la Carga rápida usa
 * la misma regla en su DTO).
 *
 * Nacieron de dos cosas vistas en producción: un negocio dio de alta
 * «CUBREADULTOAZUL» como código de barras, y el 7503010020615 de una farmacia
 * no le aparecía a otro negocio porque solo la Carga rápida aportaba al
 * catálogo compartido.
 */

export type BarcodeProblem = "products.invalid_barcode" | "products.barcode_check_digit";

/**
 * La clave i18n de lo que está mal, o `null` si el código sirve. Son dos
 * mensajes y no uno porque se corrigen distinto: las letras van en «Código
 * interno»; un dígito verificador que no cuadra es un dedazo.
 */
export function barcodeProblem(code: string): BarcodeProblem | null {
  if (!isScannableBarcode(code)) {
    return "products.invalid_barcode";
  }
  return isValidBarcode(code) ? null : "products.barcode_check_digit";
}

/** Para los DTO de ALTA: el código que llega nuevo tiene que servir. */
export function refineBarcode(code: string, ctx: z.RefinementCtx): void {
  const problema = barcodeProblem(code);
  if (problema !== null) {
    ctx.addIssue({ code: "custom", message: problema });
  }
}

/**
 * Para EDITAR: se valida solo si el código CAMBIA.
 *
 * El formulario reenvía el código en cada guardado, y en producción hay
 * productos con códigos de antes de esta regla («AJOLOCARAMELO»). Validarlos
 * aunque nadie los tocara los dejaría sin poder cambiarles ni el precio.
 * `null` borra el código, y borrar siempre se puede.
 */
export function assertBarcodeChange(
  next: string | null | undefined,
  current: string | null | undefined,
): void {
  if (next === undefined || next === null || next === (current ?? null)) {
    return;
  }
  const problema = barcodeProblem(next);
  if (problema !== null) {
    throw new BadRequestException({ message: problema });
  }
}

/**
 * Lo que se aporta al catálogo compartido por un código guardado, o `null`.
 *
 * Solo la unidad base (`factor` 1) y con el nombre del producto: el código de
 * una caja de 12 aportado con el nombre de la pieza le sugeriría la pieza a
 * quien escanea la caja. Lo demás —el GTIN válido, el prefijo importable,
 * no pisar lo escrito— lo decide `BarcodeContributionService`, igual que para
 * la Carga rápida.
 */
export function contributionOf(
  barcode: string | null | undefined,
  name: string,
  factor: number | { toString(): string },
): BarcodeContribution | null {
  if (barcode === null || barcode === undefined || Number(factor.toString()) !== 1) {
    return null;
  }
  const gtin = classifyGtin(barcode);
  if (gtin === null || gtin.prefix === null) {
    return null;
  }
  return { gtin14: gtin.gtin14, prefix: gtin.prefix, name };
}
