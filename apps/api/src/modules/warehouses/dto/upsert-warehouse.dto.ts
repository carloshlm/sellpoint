import { z } from "zod";

// `address` es TEXTO LIBRE y opcional: SellPoint vende a 26 mercados y los
// formatos postales difieren (MERCADOS.md § 4). El desglose
// colonia/alcaldía/estado del diseño original era México-céntrico.
export const createWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500).optional(),
});

export const updateWarehouseSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "warehouses.empty_update" });

export type CreateWarehouseDto = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseDto = z.infer<typeof updateWarehouseSchema>;
