import { PAYMENT_METHODS } from "@sellpoint/shared";
import { z } from "zod";

/**
 * La línea que manda el carrito: **ids y cantidades, NUNCA precios.**
 *
 * El precio lo pone el servidor leyendo el catálogo. Si viajara en el POST,
 * alterarlo sería cambiar lo que se cobra — y no habría forma de distinguir un
 * descuento legítimo de una manipulación. El descuento sí viaja, porque es una
 * decisión de quien vende y queda registrada como tal.
 */
const saleLineSchema = z
  .object({
    productId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    presentationId: z.string().uuid().optional(),
    /**
     * La línea de la cotización de la que salió este renglón.
     *
     * F4-CONCEPT-06: en un CONCEPTO es la identidad — sin catálogo que releer,
     * el servidor copia de ahí descripción y precio, y sin cotización no hay
     * concepto que cobrar.
     *
     * F4-CONCEPT-10: en un producto o un servicio es el RASTRO — acompaña al
     * id del catálogo para que la venta recuerde qué módulo emitió la línea
     * (una receta, una orden de trabajo). El precio lo sigue poniendo el
     * catálogo: el rastro no decide cuánto se cobra.
     */
    quoteLineId: z.string().uuid().optional(),
    quantity: z.coerce.number().positive({ message: "pos.quantity_positive" }),
    discount: z.coerce.number().min(0).optional(),
  })
  .strict()
  .refine(
    (line) => {
      const delCatalogo = [line.productId, line.serviceId].filter((v) => v !== undefined).length;
      // Producto o servicio: exactamente uno, con el rastro como opcional.
      // Concepto: ninguno de los dos y su línea de cotización como identidad.
      return delCatalogo === 1 || (delCatalogo === 0 && line.quoteLineId !== undefined);
    },
    { message: "pos.line_kind_invalid" },
  )
  .refine((line) => line.presentationId === undefined || line.productId !== undefined, {
    message: "pos.presentation_only_for_products",
  });

export const createSaleSchema = z
  .object({
    paymentMethod: z.enum(PAYMENT_METHODS, { message: "pos.payment_method_invalid" }),
    lines: z.array(saleLineSchema).min(1, { message: "pos.sale_needs_lines" }),
    /** La cotización que se cargó, si el carrito vino de una (F4-QUOTE-02). */
    quoteId: z.string().uuid().optional(),
  })
  .strict();

export type CreateSaleDto = z.infer<typeof createSaleSchema>;
export type SaleLineDto = z.infer<typeof saleLineSchema>;
