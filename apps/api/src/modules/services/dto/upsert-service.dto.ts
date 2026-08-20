import { z } from "zod";
import { moneyAmount } from "../../products/money";

/**
 * F3-SVC-03. Espejo del modelo `Service`.
 *
 * `code` es el nombre corto con el que se busca en el POS (espejo del `sku` de
 * un producto). `cost` y `price` reusan `moneyAmount()` — el MISMO validador
 * que productos, para que la regla de decimales y el techo se corrijan en un
 * solo lugar.
 */
export const createServiceSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  cost: moneyAmount().optional(),
  price: moneyAmount().optional(),
  /**
   * F3-SVC-07. En qué almacenes se ofrece. Semántica EXPLÍCITA: `[]` es válido
   * y significa que el servicio **no se vende en ningún lado** todavía — al
   * revés que el alcance de usuarios, donde vacío = todos. Requerido en el
   * alta porque el form siempre lo manda (nace con todos marcados).
   */
  warehouseIds: z.array(z.uuid()).max(200),
});

export const updateServiceSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    cost: moneyAmount().nullable().optional(),
    price: moneyAmount().nullable().optional(),
    isActive: z.boolean().optional(),
    /** Presente = REEMPLAZO completo del set. Ausente = no tocar. */
    warehouseIds: z.array(z.uuid()).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "services.empty_update" });

export const listServicesQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
});

export type CreateServiceDto = z.infer<typeof createServiceSchema>;
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
