import { z } from "zod";
import { moneyAmount } from "../money";

/**
 * F2-PROD-01. `price`, `cost` y `barcode` viajan acá aunque NO sean columnas
 * de `products`: el service los usa para crear/actualizar la presentación base
 * «Unidad ×1» (decisión de Carlos, 2026-08-16 — una sola fuente de verdad
 * para el precio, y se llena desde la misma interfaz del catálogo).
 *
 * El `barcode` se sumó el 2026-08-24 por el mismo criterio: «no me gusta que
 * se tenga que hacer dos pasos para dar de alta un producto y asignarle un
 * código de barras después» (Carlos). Para el usuario es «el código del
 * producto»; para el modelo sigue siendo la fila base, y ahí tiene que estar
 * porque la caja de 12 y la pieza suelta llevan códigos DISTINTOS — es lo que
 * deja al POS preseleccionar la presentación correcta al escanear.
 */
export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  baseUnit: z.string().trim().min(1).max(8).default("unit"),
  /** Dónde SUELE estar (pasillo, estante). Referencia: no parte el saldo. */
  location: z.string().trim().max(64).nullish(),
  stockMin: z.number().nonnegative().default(0),
  isComposite: z.boolean().default(false),
  /** Opt-in al control de lote y caducidad. Ver la guarda de `update`. */
  tracksLots: z.boolean().default(false),
  attributes: z.record(z.string(), z.unknown()).default({}),
  price: moneyAmount().optional(),
  cost: moneyAmount().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
});

export const updateProductSchema = z
  .object({
    sku: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    baseUnit: z.string().trim().min(1).max(8).optional(),
    stockMin: z.number().nonnegative().optional(),
    // `null` la BORRA (el producto ya no tiene un lugar fijo); `undefined`
    // es «no la toques» — misma distinción que el código de barras.
    location: z.string().trim().max(64).nullable().optional(),
    isComposite: z.boolean().optional(),
    tracksLots: z.boolean().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    price: moneyAmount().nullable().optional(),
    cost: moneyAmount().nullable().optional(),
    // `null` BORRA el código; `undefined` es «no lo toques». La distinción
    // importa: un producto puede perder su código de barras a propósito.
    barcode: z.string().trim().min(1).max(64).nullable().optional(),
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
