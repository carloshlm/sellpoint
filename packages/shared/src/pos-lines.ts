import { z } from "zod";

/**
 * F4-CONCEPT-01 — los tipos de línea de una cotización y de una venta.
 *
 * `product` y `service` son los de siempre. `concept` es lo que no está en
 * ningún catálogo del POS —un flete, un anticipo, un estudio de laboratorio
 * que emite un módulo vertical—: una descripción y un precio, sin stock y
 * sin ledger. La base espeja esta lista con un CHECK de forma por tipo
 * (`quote_lines_kind_shape`, `sale_items_kind_shape`); la lista canónica vive
 * acá, como `MODULE_KEYS`, para que el API, el web y el ticket hablen de lo
 * mismo.
 *
 * La regla de seguridad que acompaña al concepto (decisión de Carlos,
 * 2026-09-03): se COTIZA con `pos:quote` y se COBRA solo cargando esa
 * cotización por folio. La venta nunca acepta un precio del cliente.
 */
export const POS_LINE_KINDS = ["product", "service", "concept"] as const;
export type PosLineKind = (typeof POS_LINE_KINDS)[number];
export const posLineKindSchema = z.enum(POS_LINE_KINDS);

/** Lo que define a un concepto al cotizarlo: el texto del papel y su precio. */
export const conceptLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  unitPrice: z.number().min(0),
});
export type ConceptLine = z.infer<typeof conceptLineSchema>;
