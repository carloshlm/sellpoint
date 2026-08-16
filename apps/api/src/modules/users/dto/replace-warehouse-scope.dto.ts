import { z } from "zod";

/**
 * F2-SCOPE-02. Reemplaza el SET completo, no un delta — la UI muestra
 * checkboxes y guarda lo que quedó marcado.
 *
 * Array VACÍO es válido y significa "sin restricción": el interceptor le da
 * todos los almacenes (F2-SCOPE-01, default permisivo).
 */
export const replaceWarehouseScopeSchema = z.object({
  warehouseIds: z.array(z.string().uuid()).max(200),
});

export type ReplaceWarehouseScopeDto = z.infer<typeof replaceWarehouseScopeSchema>;
