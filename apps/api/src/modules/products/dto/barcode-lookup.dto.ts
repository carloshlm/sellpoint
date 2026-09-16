import { z } from "zod";

/**
 * F10-QUICKCAT-02 — lo que llega del lector en la carga rápida.
 *
 * El tope de 64 es el mismo de `barcode` en el alta de producto: lo que no se
 * puede guardar tampoco tiene sentido buscarlo.
 */
export const barcodeLookupQuerySchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export type BarcodeLookupQuery = z.infer<typeof barcodeLookupQuerySchema>;
