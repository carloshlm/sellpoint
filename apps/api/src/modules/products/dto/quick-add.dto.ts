import { QUICK_ADD_MAX_LINES } from "@sellpoint/shared";
import { z } from "zod";
import { moneyAmount } from "../money";

/**
 * F10-QUICKCAT-04 — el borrador de la carga rápida, tal como sale de la
 * pantalla: código escaneado, nombre y precio de venta. Nada más.
 *
 * Existencias, costo, unidad e impuesto NO viajan a propósito. El costo se
 * descubre al recibir mercancía e inventarlo envenena los márgenes; la
 * existencia entra por una Entrada, que es donde el sistema pide almacén,
 * lote y caducidad.
 *
 * El tope de líneas sale de `@sellpoint/shared` y no de una constante local:
 * la pantalla lee el MISMO número. Ver `QUICK_ADD_MAX_LINES`.
 */
export const quickAddSchema = z.object({
  lines: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(200),
        /**
         * Obligatorio: esta pantalla existe para ponerle precio a lo que se
         * escanea. Un producto sin precio no se puede cobrar, y quien lo
         * descubre es el cajero con el cliente enfrente.
         */
        price: moneyAmount(),
      }),
    )
    .min(1)
    .max(QUICK_ADD_MAX_LINES),
});

export type QuickAddDto = z.infer<typeof quickAddSchema>;
