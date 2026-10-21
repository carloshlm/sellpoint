import { z } from "zod";
import { moduleKeySchema } from "./modules";

/**
 * F9-RECEP-21 — la ANOTACIÓN de una venta: lo único que un módulo vertical le
 * devuelve a la caja cuando reacciona a un cobro (ley 31 de la Fase 9).
 *
 * El primer uso es Recepción: al venderse un servicio marcado, crea el turno y
 * devuelve «Turno: 7». La caja no sabe qué es un turno —la ley 16 le prohíbe
 * importar un módulo vertical—; solo guarda la anotación en
 * `sales.annotations`, la imprime en el ticket y la devuelve en la venta.
 *
 * - `labelKey` es una CLAVE de i18n, no un texto: el ticket se imprime y se
 *   reimprime en el idioma de quien lo pide, y el web traduce la misma clave.
 * - `emphasis` decide el tamaño: las enfáticas van en grande y centradas en el
 *   papel (el número que el paciente tiene que leer de un vistazo).
 *
 * El POS valida con este schema ANTES de guardar: un módulo con un bug no
 * puede escribir basura en la venta ni romper el ticket de nadie.
 */

/** Cuántas anotaciones caben en una venta. Diez turnos de una sola línea ya es un exceso. */
export const SALE_ANNOTATIONS_MAX = 10;

/** Una clave de i18n: minúscula al inicio, sin espacios (`reception.saleAnnotation.turn`). */
const CLAVE_I18N = /^[a-z][a-zA-Z0-9_.]*$/;

export const saleAnnotationSchema = z
  .object({
    sourceModule: moduleKeySchema,
    labelKey: z.string().max(80).regex(CLAVE_I18N),
    value: z.string().min(1).max(40),
    emphasis: z.boolean(),
  })
  .strict();

export type SaleAnnotation = z.infer<typeof saleAnnotationSchema>;

export const saleAnnotationsSchema = z.array(saleAnnotationSchema).max(SALE_ANNOTATIONS_MAX);
