import type { MovementReason } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import type { AuditService } from "../audit/audit.service";

/**
 * Las acciones que puede registrar la fase. Un set cerrado y no un string
 * libre: buscar en el audit log por "todas las salidas" exige que todas se
 * llamen igual.
 */
export const INVENTORY_AUDIT_ACTIONS = [
  "inventory.entry",
  "inventory.exit",
  // Una salida con motivo traspaso: es un `exit` para el ledger pero se audita
  // distinto porque abre un proceso que alguien tiene que cerrar.
  "inventory.transfer_dispatch",
  "inventory.transfer_receive",
  "inventory.transfer_cancel",
  "inventory.physical_count_approve",
] as const;

export type InventoryAuditAction = (typeof INVENTORY_AUDIT_ACTIONS)[number];

export interface MovementAuditLine {
  productId: string;
  quantity: string;
  /** El saldo que quedó DESPUÉS de esta línea. */
  balanceAfter: string;
  parentProductId?: string | null;
  lotId?: string | null;
}

export interface MovementAuditInput {
  user: { userId: string; tenantId: string };
  action: InventoryAuditAction;
  documentId: string;
  folio: string;
  warehouseId: string;
  reasonCode: MovementReason;
  lines: MovementAuditLine[];
  extra?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * F3-CORE-07 — el rastro de un movimiento.
 *
 * Se ancla en el **documento** (`resourceType: 'inventory_document'`) y no en
 * cada línea: quien audita pregunta "¿qué pasó con la entrada ENT-000042?",
 * no por el uuid de un movimiento. Por lo mismo el **folio viaja en el
 * payload**, aunque sea derivable: es el único dato que una persona tiene en
 * la mano.
 *
 * Recibe la `tx` del ledger y no abre una propia. Si el registro fuera una
 * transacción aparte, un fallo entre medio dejaría stock movido sin rastro de
 * quién lo movió — que es exactamente el caso en el que un audit log importa.
 *
 * Guarda el **saldo posterior por línea**: sin él, reconstruir cómo llegó el
 * inventario a su estado actual exigiría recalcular todo el histórico.
 */
export async function recordMovementAudit(
  tx: Prisma.TransactionClient,
  auditService: AuditService,
  input: MovementAuditInput,
): Promise<void> {
  await auditService.record(tx, {
    tenantId: input.user.tenantId,
    userId: input.user.userId,
    action: input.action,
    resourceType: "inventory_document",
    resourceId: input.documentId,
    // `before` no aplica: un movimiento no modifica algo que existía, lo crea.
    before: undefined,
    // El doble cast es el precio de que `InputJsonValue` sea un tipo recursivo
    // que TypeScript no puede reconciliar con una interfaz concreta. La forma
    // real la fija el test, que compara el payload guardado.
    after: {
      folio: input.folio,
      warehouseId: input.warehouseId,
      reasonCode: input.reasonCode,
      lines: input.lines,
      ...input.extra,
    } as unknown as Prisma.InputJsonValue,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
