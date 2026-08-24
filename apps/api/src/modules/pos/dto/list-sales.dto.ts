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
    /** Parcial e insensible, como el de cotizaciones: quien dicta el folio
     *  por teléfono dice «cero cero uno», no «VTA-000001». Nace junto al
     *  código de barras del ticket (2026-08-24): escanearlo busca por acá. */
    folio: z.string().trim().max(32).optional(),
    sellerId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    status: z.enum(["completed", "canceled"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
