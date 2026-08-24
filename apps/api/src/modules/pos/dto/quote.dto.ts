import { z } from "zod";

/**
 * La línea de una cotización: **el mismo shape que la de venta, a propósito.**
 *
 * Que se parezcan tanto no es duplicación por descuido: es lo que hace que
 * volcar una cotización al carrito sea un mapeo directo y no una traducción.
 * Lo que NO viaja, igual que en la venta, es el precio — lo pone el servidor
 * leyendo el catálogo.
 */
const quoteLineSchema = z
  .object({
    productId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    presentationId: z.string().uuid().optional(),
    quantity: z.coerce.number().positive({ message: "pos.quantity_positive" }),
  })
  .strict()
  .refine((line) => (line.productId === undefined) !== (line.serviceId === undefined), {
    message: "pos.line_product_xor_service",
  })
  .refine((line) => line.presentationId === undefined || line.productId !== undefined, {
    message: "pos.presentation_only_for_products",
  });

export const createQuoteSchema = z
  .object({
    /**
     * Opcional: sin él se usa el almacén ASIGNADO del cotizador. A diferencia
     * de la venta —que hereda el almacén del TURNO— cotizar no exige caja, así
     * que el almacén hay que resolverlo por otro lado.
     */
    warehouseId: z.string().uuid().optional(),
    lines: z.array(quoteLineSchema).min(1, { message: "pos.quote_needs_lines" }),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;
export type QuoteLineDto = z.infer<typeof quoteLineSchema>;

export const cancelQuoteSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CancelQuoteDto = z.infer<typeof cancelQuoteSchema>;

export const listQuotesQuerySchema = z
  .object({
    /** Búsqueda por folio, parcial: el cliente dicta "cero cero uno" por teléfono. */
    folio: z.string().trim().max(32).optional(),
    status: z.enum(["open", "loaded", "canceled"]).optional(),
    /**
     * Días del calendario del NEGOCIO (`YYYY-MM-DD`), no instantes.
     *
     * Antes esto exigía fecha-hora ISO con offset, así que armar el instante
     * quedaba del lado del front — y ahí nace el bug de «los de hoy no
     * salen», que Carlos reportó el 2026-08-24 en el kardex. La traducción a
     * UTC es del servidor, que es quien conoce la zona del tenant.
     */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;
