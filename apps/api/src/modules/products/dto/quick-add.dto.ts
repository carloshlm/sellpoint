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
 * El tope de 100 líneas es el MISMO de la pantalla. Que el navegador permita
 * más de lo que el servidor acepta sería una pared al final del trabajo, y son
 * 200 escrituras en una sola transacción: un lote de 800 se comería el tiempo
 * límite y reventaría recién al final, con todo por rehacer.
 */
export const QUICK_ADD_MAX_LINES = 100;

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
