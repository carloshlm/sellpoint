import { z } from "zod";
import { moneyAmount } from "../money";

/**
 * F2-PROD-01. `price` y `cost` viajan acá aunque NO sean columnas de
 * `products`: el service los usa para crear/actualizar la presentación base
 * «Unidad ×1» (decisión de Carlos, 2026-08-16 — una sola fuente de verdad
 * para el precio, y se llena desde la misma interfaz del catálogo).
 */
export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  baseUnit: z.string().trim().min(1).max(8).default("unit"),
  stockMin: z.number().nonnegative().default(0),
  isComposite: z.boolean().default(false),
  /** Opt-in al control de lote y caducidad. Ver la guarda de `update`. */
  tracksLots: z.boolean().default(false),
  attributes: z.record(z.string(), z.unknown()).default({}),
  price: moneyAmount().optional(),
  cost: moneyAmount().optional(),
});

export const updateProductSchema = z
  .object({
    sku: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    baseUnit: z.string().trim().min(1).max(8).optional(),
    stockMin: z.number().nonnegative().optional(),
    isComposite: z.boolean().optional(),
    tracksLots: z.boolean().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    price: moneyAmount().nullable().optional(),
    cost: moneyAmount().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "products.empty_update" });

// Filtros por campo personalizado: `attr.<key>=<valor>` se arma en el
// controller a partir de la query, para no fijar acá qué campos existen (LEY
// de genericidad).
export const listProductsQuerySchema = z.object({
  query: z.string().trim().optional(),
  composite: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;
export type UpdateProductDto = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
