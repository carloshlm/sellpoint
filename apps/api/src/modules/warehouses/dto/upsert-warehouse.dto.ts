import { isE164 } from "@sellpoint/shared";
import { z } from "zod";

// `address` es TEXTO LIBRE y opcional: SellPoint vende a 26 mercados y los
// formatos postales difieren (MERCADOS.md § 4). El desglose
// colonia/alcaldía/estado del diseño original era México-céntrico.
//
// Contacto estándar (Carlos, 2026-08-26): `phone` viaja como E.164 canónico
// — el front compone país+número, igual que el teléfono del negocio — y se
// valida acá, sin CHECK SQL (criterio de tenant_phone_e164). `attributes`
// llega sin tipar: la forma real la valida el motor de catálogos contra los
// campos del catálogo de sistema "warehouses".
export const createWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500).optional(),
  phone: z.string().refine(isE164, { message: "warehouses.invalid_phone" }).optional(),
  email: z.string().trim().email("warehouses.invalid_email").max(254).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export const updateWarehouseSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(500).nullable().optional(),
    phone: z.string().refine(isE164, { message: "warehouses.invalid_phone" }).nullable().optional(),
    email: z.string().trim().email("warehouses.invalid_email").max(254).nullable().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "warehouses.empty_update" });

export type CreateWarehouseDto = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseDto = z.infer<typeof updateWarehouseSchema>;
