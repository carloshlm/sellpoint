import { z } from "zod";

/** Anular exige explicar por qué: una venta deshecha sin motivo no se audita. */
export const cancelSaleSchema = z
  .object({
    reason: z.string().trim().min(3, { message: "pos.cancel_reason_required" }).max(500),
  })
  .strict();

export type CancelSaleDto = z.infer<typeof cancelSaleSchema>;

/**
 * El historial. Las anuladas **no se esconden**: se ven marcadas.
 *
 * Filtrarlas por defecto sería tentador —"ruido"— y sería exactamente lo que
 * no se debe hacer: quien busca una venta que no cuadra necesita encontrarla
 * justo cuando está anulada.
 */
export const listSalesQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    sellerId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    status: z.enum(["completed", "canceled"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
