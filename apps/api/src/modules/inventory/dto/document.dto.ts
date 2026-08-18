import {
  INVENTORY_DOCUMENT_TYPES,
  SELECTABLE_ENTRY_REASONS,
  SELECTABLE_EXIT_REASONS,
} from "@sellpoint/shared";
import { z } from "zod";
import { moneyAmount } from "../../products/money";
import { quantityAmount } from "./movement.dto";

export const createDocumentSchema = z.object({
  type: z.enum(INVENTORY_DOCUMENT_TYPES),
  warehouseId: z.uuid(),
});

export const cancelDocumentSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * La línea de un BORRADOR, no la de un asiento.
 *
 * `quantity` es opcional a propósito: quien está cargando 80 productos agrega
 * la fila y después escribe la cantidad, y perder ese trabajo porque el
 * autoguardado rechazó una línea a medio llenar sería exactamente el problema
 * que el borrador vino a resolver. La validación dura es del `confirm`.
 */
export const upsertDocumentLineSchema = z.object({
  productId: z.uuid(),
  presentationId: z.uuid().nullish(),
  quantity: quantityAmount().nullish(),
  unitCost: moneyAmount().nullish(),
  lotCode: z.string().trim().min(1).max(64).nullish(),
  expiresAt: z.iso.date().nullish(),
  location: z.string().trim().max(64).nullish(),
  counted: quantityAmount().nullish(),
});

export const replaceDocumentLinesSchema = z.object({
  lines: z.array(upsertDocumentLineSchema).max(500),
});

export type CreateDocumentDto = z.infer<typeof createDocumentSchema>;
export type CancelDocumentDto = z.infer<typeof cancelDocumentSchema>;
export type UpsertDocumentLineDto = z.infer<typeof upsertDocumentLineSchema>;
export type ReplaceDocumentLinesDto = z.infer<typeof replaceDocumentLinesSchema>;

/** Modo de carga: `replace` pisa lo que había; `append` suma al final. */
export const importDocumentLinesSchema = z.object({
  file: z.string().min(1),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  mode: z.enum(["replace", "append"]).default("append"),
});

export const documentTemplateQuerySchema = z.object({
  type: z.enum(INVENTORY_DOCUMENT_TYPES),
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

export type ImportDocumentLinesDto = z.infer<typeof importDocumentLinesSchema>;
export type DocumentTemplateQueryDto = z.infer<typeof documentTemplateQuerySchema>;

/**
 * Filtros del listado. `type` es obligatorio porque las tres pantallas
 * (Entradas, Salidas, Inventario) son el MISMO componente con distinto tipo:
 * un listado sin tipo no corresponde a ninguna.
 *
 * `status` por defecto trae borradores y confirmados. Los anulados quedan
 * fuera salvo que se pidan: crear un borrador es barato y va a haber anulados
 * vacíos, que no tienen por qué ensuciar la vista de todos los días.
 */
export const listDocumentsQuerySchema = z.object({
  type: z.enum(INVENTORY_DOCUMENT_TYPES),
  status: z.enum(["draft", "confirmed", "canceled"]).optional(),
  warehouseId: z.uuid().optional(),
  createdBy: z.uuid().optional(),
  folio: z.string().trim().min(1).max(20).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type ListDocumentsQueryDto = z.infer<typeof listDocumentsQuerySchema>;

/**
 * La cabecera del borrador: lo que se edita mientras se carga (autoguardado).
 *
 * `reasonCode` acepta **todos** los motivos seleccionables de las dos
 * direcciones porque el mismo endpoint sirve a entradas y salidas; que el
 * motivo corresponda al TIPO del documento lo valida el confirm, que es quien
 * sabe qué documento es.
 */
export const updateDocumentSchema = z.object({
  reasonCode: z.enum([...SELECTABLE_ENTRY_REASONS, ...SELECTABLE_EXIT_REASONS]).optional(),
  reference: z.string().trim().min(1).max(120).nullish(),
  reasonNote: z.string().trim().min(1).nullish(),
  authorizedBy: z.uuid().nullish(),
  linkedWarehouseId: z.uuid().nullish(),
});

export type UpdateDocumentDto = z.infer<typeof updateDocumentSchema>;
