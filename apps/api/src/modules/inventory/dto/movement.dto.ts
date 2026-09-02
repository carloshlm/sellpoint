import {
  hasValidQuantityScale,
  normalizeLotCode,
  QUANTITY_MAX,
  REASON_RULES,
  SELECTABLE_ENTRY_REASONS,
  SELECTABLE_EXIT_REASONS,
} from "@sellpoint/shared";
import { z } from "zod";
import { moneyAmount } from "../../products/money";

/**
 * El código de lote entra NORMALIZADO: mayúsculas y dígitos. `product_lots`
 * tiene `@@unique([productId, lotCode])`, así que `STM01` y `stm01` serían dos
 * lotes distintos del mismo producto — existencias partidas y FEFO tratándolos
 * por separado. Se hace acá y no solo en la pantalla porque cualquier otro
 * camino al API (una importación, otro cliente) se saltaría la regla.
 *
 * El `min(1)` va DESPUÉS del transform a propósito: `"---"` normaliza a vacío,
 * y eso tiene que ser un 400 —«ese código no sirve»— y no un lote sin nombre.
 */
function lotCodeField() {
  return z.string().trim().max(64).transform(normalizeLotCode).pipe(z.string().min(1).max(64));
}

/**
 * Cantidad positiva que cabe en `DECIMAL(14,4)`.
 *
 * Los dos límites se validan por separado, igual que `moneyAmount()`: "admite
 * 4 decimales" sería una respuesta engañosa si lo que el usuario escribió fue
 * un número de diez mil millones.
 *
 * El quinto decimal se rechaza y no se redondea porque la columna lo
 * redondearía **en silencio**: el usuario vería un saldo que no es el que
 * escribió, y descubrirlo exigiría un inventario físico.
 */
export function quantityAmount() {
  return z
    .number()
    .positive("inventory.quantity_must_be_positive")
    .max(QUANTITY_MAX, "inventory.quantity_too_large")
    .refine(hasValidQuantityScale, "inventory.quantity_too_many_decimals");
}

/**
 * Lo CONTADO en un inventario físico (Carlos, 2026-09-01): el cero vale —es
 * el estante vacío, el hallazgo más importante de un conteo—; el negativo no
 * existe en el mundo físico y se rechaza en la puerta.
 */
export function countedAmount() {
  return z
    .number()
    .min(0, "inventory.count_negative")
    .max(QUANTITY_MAX, "inventory.quantity_too_large")
    .refine(hasValidQuantityScale, "inventory.quantity_too_many_decimals");
}

const movementLineSchema = z.object({
  productId: z.uuid(),
  presentationId: z.uuid().optional(),
  quantity: quantityAmount(),
  unitCost: moneyAmount().optional(),
  lotCode: lotCodeField().optional(),
  expiresAt: z.iso.date().optional(),
  location: z.string().trim().max(64).optional(),
  lotId: z.uuid().optional(),
});

/**
 * 500 líneas es el techo de un movimiento capturado a mano o pegado desde una
 * planilla chica. Arriba de eso el camino es la importación por archivo, que
 * reporta errores por fila en vez de rechazar el lote entero.
 */
const linesSchema = z.array(movementLineSchema).min(1).max(500);

const headerShape = {
  warehouseId: z.uuid(),
  reference: z.string().trim().min(1).max(120).optional(),
  reasonNote: z.string().trim().min(1).optional(),
  authorizedBy: z.uuid().optional(),
  linkedWarehouseId: z.uuid().optional(),
  transferId: z.uuid().optional(),
  lines: linesSchema,
};

type MovementBody = {
  reasonCode: string;
  reference?: string;
  reasonNote?: string;
  linkedWarehouseId?: string;
  lines: { unitCost?: number }[];
};

/**
 * Aplica `REASON_RULES` — la MISMA tabla de `packages/shared` que hace reactivo
 * al formulario. Que la regla viva en un solo lugar es lo que evita que el
 * front pida un campo que el API no exige, o al revés: un 400 sobre algo que
 * la pantalla nunca mostró.
 *
 * Los errores salen por RUTA (`lines.1.unitCost`) para que el formulario los
 * pinte sobre la fila que falló, no como un mensaje suelto arriba.
 */
function applyReasonRules(body: MovementBody, ctx: z.RefinementCtx): void {
  const rules = REASON_RULES[body.reasonCode as keyof typeof REASON_RULES];
  if (rules === undefined) {
    return;
  }

  if (rules.requiresReference && !body.reference) {
    ctx.addIssue({ code: "custom", path: ["reference"], message: "inventory.reference_required" });
  }
  if (rules.requiresNote && !body.reasonNote) {
    ctx.addIssue({ code: "custom", path: ["reasonNote"], message: "inventory.note_required" });
  }
  if (rules.requiresLinkedWarehouse && !body.linkedWarehouseId) {
    ctx.addIssue({
      code: "custom",
      path: ["linkedWarehouseId"],
      message: "inventory.linked_warehouse_required",
    });
  }
  if (rules.requiresUnitCost) {
    body.lines.forEach((line, index) => {
      if (line.unitCost === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "unitCost"],
          message: "inventory.unit_cost_required",
        });
      }
    });
  }
}

/**
 * Los motivos del enum son un SUBCONJUNTO de los válidos: `sale` y
 * `sale_return` los emite el POS de F4, `physical_count` la aprobación del
 * conteo, y `transfer` en entrada la recepción (que se llega desde la vista de
 * tránsito). Ofrecerlos acá dejaría armar un movimiento que el service rechaza
 * después con 422.
 */
export const createEntrySchema = z
  .object({ ...headerShape, reasonCode: z.enum(SELECTABLE_ENTRY_REASONS) })
  .superRefine(applyReasonRules);

export const createExitSchema = z
  .object({ ...headerShape, reasonCode: z.enum(SELECTABLE_EXIT_REASONS) })
  .superRefine(applyReasonRules);

export type CreateEntryDto = z.infer<typeof createEntrySchema>;
export type CreateExitDto = z.infer<typeof createExitSchema>;
export type MovementLineDto = z.infer<typeof movementLineSchema>;
