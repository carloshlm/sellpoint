import {
  type MovementReason,
  REASON_RULES,
  SELECTABLE_ENTRY_REASONS,
  SELECTABLE_EXIT_REASONS,
} from "@sellpoint/shared";
import { z } from "zod";
import type { InventoryDocumentType } from "./types";

/**
 * F3-ENTRY-02 — las reglas de la cabecera del documento, en el front.
 *
 * **Espejo exacto de `applyReasonRules` (`dto/movement.dto.ts`)**: las dos
 * leen `REASON_RULES` de `@sellpoint/shared`. Esa tabla única es lo que hace
 * que el formulario pida exactamente lo que el servidor exige — ni un campo
 * más (molestaría sin motivo) ni uno menos (el usuario se enteraría con un 400
 * sobre algo que la pantalla nunca le mostró).
 *
 * Los mensajes son CLAVES i18n, no texto: los traduce el componente, igual que
 * en `lib/rbac/schemas.ts` y `lib/auth/schemas.ts`.
 */

/** Lo que un usuario puede tipear en la cabecera. Vacío y ausente son lo mismo. */
export interface HeaderValues {
  reference?: string | null;
  reasonNote?: string | null;
  authorizedBy?: string | null;
  linkedWarehouseId?: string | null;
}

/**
 * `""` se colapsa a `undefined` ANTES de que corran las reglas: un campo
 * borrado y uno nunca escrito son el mismo estado para quien mira la pantalla,
 * y tratarlos distinto haría que " " pasara como nota válida.
 *
 * `.nullish()` y no `.optional()`, igual que el DTO del API: el documento llega
 * con los campos vacíos en `null`, y `.optional()` solo acepta `undefined`.
 * Con el primero, cada campo nulo sumaba un error de TIPO y el confirmar
 * quedaba trabado sin decir por qué.
 */
const opcional = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .nullish();

const headerShape = {
  reference: opcional,
  reasonNote: opcional,
  authorizedBy: opcional,
  linkedWarehouseId: opcional,
};

/**
 * Los motivos que el desplegable puede ofrecer.
 *
 * El conteo físico devuelve vacío a propósito: su motivo lo pone la aprobación
 * del conteo, no una persona. Y la ENTRADA no ofrece `transfer` — la recepción
 * de un traspaso se llega desde la vista de tránsito, que precarga el
 * documento; elegirlo a mano dejaría armar una entrada por traspaso sin
 * traspaso detrás.
 */
export function selectableReasons(type: InventoryDocumentType): MovementReason[] {
  if (type === "entry") {
    return [...SELECTABLE_ENTRY_REASONS];
  }
  if (type === "exit") {
    return [...SELECTABLE_EXIT_REASONS];
  }
  return [];
}

/**
 * Los motivos que OFRECEN un campo "Autoriza".
 *
 * No es una regla de validación: `authorizedBy` es opcional en el API y ningún
 * motivo lo exige. Es de PRESENTACIÓN — a quién tiene sentido ofrecerle firmar.
 * Por eso vive acá y no en `REASON_RULES`: meterlo en la tabla que consume el
 * DTO haría creer que el servidor lo valida, y no lo hace.
 *
 * Los tres mueven stock SIN un comprobante externo detrás, que es justo cuando
 * conviene que quede el nombre de quien dio el visto bueno. La factura no está
 * porque la factura ES el comprobante.
 */
export const REASONS_WITH_AUTHORIZATION: MovementReason[] = ["adjustment", "loss", "expired"];

/** Las reglas de `REASON_RULES` como issues de Zod, con la misma ruta que el API. */
function applyReasonRules(
  values: HeaderValues & { reasonCode?: string | null },
  ctx: z.RefinementCtx,
): void {
  const rules = REASON_RULES[values.reasonCode as MovementReason];
  if (rules === undefined) {
    return;
  }

  if (rules.requiresReference && !values.reference) {
    ctx.addIssue({ code: "custom", path: ["reference"], message: "inventory.reference_required" });
  }
  if (rules.requiresNote && !values.reasonNote) {
    ctx.addIssue({ code: "custom", path: ["reasonNote"], message: "inventory.note_required" });
  }
  if (rules.requiresLinkedWarehouse && !values.linkedWarehouseId) {
    ctx.addIssue({
      code: "custom",
      path: ["linkedWarehouseId"],
      message: "inventory.linked_warehouse_required",
    });
  }
}

/**
 * El schema de la cabecera PARA UN MOTIVO. Se construye por motivo y no como
 * un schema único con todo opcional porque los campos exigidos cambian con
 * cada uno: es justo lo que hace reactivo al formulario.
 *
 * `requiresUnitCost` no se valida acá — es por LÍNEA, y la línea la valida el
 * `confirm` del API sobre el borrador completo.
 */
export function headerSchemaFor(reasonCode: MovementReason | null) {
  return z
    .object({ ...headerShape, reasonCode: z.string().nullish() })
    .superRefine((values, ctx) => {
      applyReasonRules({ ...values, reasonCode: values.reasonCode ?? reasonCode }, ctx);
    });
}

/**
 * Qué le falta a la cabecera, indexado por campo — la misma forma que
 * `fieldErrorsOf` devuelve para los 400 del API, así el formulario pinta los
 * errores locales y los del servidor con el mismo código.
 */
export function headerErrors(
  reasonCode: MovementReason | null,
  values: HeaderValues,
): Map<string, string> {
  const found = new Map<string, string>();
  if (reasonCode === null) {
    return found;
  }

  const result = headerSchemaFor(reasonCode).safeParse({ ...values, reasonCode });
  if (result.success) {
    return found;
  }

  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    if (key && !found.has(key)) {
      found.set(key, issue.message);
    }
  }
  return found;
}
