import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { REASON_RULES, SELECTABLE_ENTRY_REASONS, SELECTABLE_EXIT_REASONS } from "@sellpoint/shared";
import type { InventoryDocument, Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { expandComposition } from "./composition-expander";
import { DocumentsService } from "./documents.service";
import { resolveLines } from "./line-resolver";
import { resolveLotsFefo } from "./lot-fefo";
import { recordMovementAudit } from "./movement-audit";
import { StockLedgerService } from "./stock-ledger.service";
import { assertActiveWarehouse, assertWarehouseInScope } from "./warehouse-scope.helpers";

/**
 * F3-ENTRY-01 / F3-EXIT-01 — el CONFIRM: donde el borrador se vuelve historia.
 *
 * Es el punto en que toda la maquinaria de la fase se junta, y el orden de los
 * pasos importa:
 *
 *   resolveLines(strict) → expandComposition → resolveLotsFefo
 *      → ledger.apply → audit → markConfirmed
 *
 * **`markConfirmed` va al FINAL, y no es casualidad.** El trigger de F3-DOC-02
 * congela el documento y sus líneas apenas el estado cambia: cualquier
 * escritura posterior en la misma transacción reventaría con 42501. Terminar
 * el contenido y recién entonces sellar.
 *
 * ── Acá la validación se pone dura ──────────────────────────────────────
 *
 * El borrador admitía una línea a medio llenar —quien carga 80 productos
 * agrega la fila y después escribe la cantidad— pero un asiento no. Todo lo
 * que la previa mostraba como advertencia, acá es un rechazo. Y como el
 * rechazo deja el documento en `draft`, el usuario puede corregir sin volver a
 * empezar.
 */
@Injectable()
export class ConfirmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly ledger: StockLedgerService,
    private readonly auditService: AuditService,
  ) {}

  async confirm(user: AuthUser, documentId: string, scope: UserScope) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const document = await this.documents.assertDraft(tx, user.tenantId, documentId);
      assertWarehouseInScope(scope, document.warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, document.warehouseId);

      const direction = document.type === "exit" ? "exit" : "entry";
      this.assertReason(document, direction);

      const lines = await tx.inventoryDocumentLine.findMany({
        where: { documentId },
        orderBy: { lineNo: "asc" },
      });
      if (lines.length === 0) {
        throw new UnprocessableEntityException({ message: "inventory.document_empty" });
      }

      const reasonCode = document.reasonCode as NonNullable<typeof document.reasonCode>;
      this.assertHeaderRules(document, lines);

      // 1. Resolver: presentación → unidad base, lotes, estado del producto.
      const resolved = await resolveLines(
        tx,
        user.tenantId,
        lines.map((l) => ({
          productId: l.productId,
          presentationId: l.presentationId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lotCode: l.lotCode,
          expiresAt: l.expiresAt,
          location: l.location,
        })),
        { direction, reasonCode },
      );

      // 2. Un compuesto sale como sus componentes (solo en salidas).
      const expanded = await expandComposition(tx, user.tenantId, resolved);

      // 3. FEFO: las salidas sin lote elegido salen del que vence antes.
      const conLotes =
        direction === "exit"
          ? await resolveLotsFefo(tx, user.tenantId, document.warehouseId, expanded)
          : expanded;

      // 4. Asentar. Acá es donde el stock se mueve, con las filas bloqueadas.
      const result = await this.ledger.apply(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        direction,
        reasonCode,
        warehouseId: document.warehouseId,
        lines: conLotes,
        header: {
          documentId,
          reasonNote: document.reasonNote,
          reference: document.reference,
          authorizedBy: document.authorizedBy,
          linkedWarehouseId: document.linkedWarehouseId,
        },
      });

      const saldoPorProducto = new Map(result.stock.map((s) => [s.productId, s.quantity]));
      await recordMovementAudit(tx, this.auditService, {
        user,
        action:
          reasonCode === "transfer" && direction === "exit"
            ? "inventory.transfer_dispatch"
            : direction === "entry"
              ? "inventory.entry"
              : "inventory.exit",
        documentId,
        folio: document.folio,
        warehouseId: document.warehouseId,
        reasonCode,
        lines: conLotes.map((l) => ({
          productId: l.productId,
          quantity: l.quantityBase.toString(),
          balanceAfter: saldoPorProducto.get(l.productId) ?? "0",
          parentProductId: l.parentProductId ?? null,
          lotId: l.lotId ?? null,
        })),
      });

      // 5. Sellar. ÚLTIMO: a partir de acá el trigger congela el documento.
      const confirmed = await this.documents.markConfirmed(
        tx,
        user.tenantId,
        documentId,
        user.userId,
      );

      return {
        document: {
          id: confirmed.id,
          folio: confirmed.folio,
          type: confirmed.type,
          status: confirmed.status,
        },
        movements: result.movements,
        stock: result.stock,
        lots: result.lots,
      };
    });
  }

  /**
   * El motivo tiene que existir y corresponder al TIPO del documento. Los que
   * emite solo el sistema (`sale`, `sale_return`, `physical_count`) no se
   * confirman por esta puerta.
   */
  private assertReason(document: InventoryDocument, direction: "entry" | "exit"): void {
    const permitidos: readonly string[] =
      direction === "entry" ? SELECTABLE_ENTRY_REASONS : SELECTABLE_EXIT_REASONS;

    if (document.reasonCode === null) {
      throw new UnprocessableEntityException({
        message: "inventory.reason_required",
        args: { field: "reasonCode" },
      });
    }
    if (!permitidos.includes(document.reasonCode)) {
      throw new UnprocessableEntityException({
        message: "inventory.reason_not_allowed",
        args: { field: "reasonCode" },
      });
    }
  }

  /**
   * Aplica `REASON_RULES` sobre lo que quedó guardado en el borrador. Es la
   * MISMA tabla que valida el DTO de captura y que hace reactivo al
   * formulario: si el usuario borró la referencia después de elegir el motivo,
   * acá se entera.
   */
  private assertHeaderRules(
    document: InventoryDocument,
    lines: { unitCost: Prisma.Decimal | null; lineNo: number }[],
  ): void {
    const rules = REASON_RULES[document.reasonCode as keyof typeof REASON_RULES];
    if (rules === undefined) {
      return;
    }
    if (rules.requiresReference && !document.reference) {
      throw new UnprocessableEntityException({
        message: "inventory.reference_required",
        args: { field: "reference" },
      });
    }
    if (rules.requiresNote && !document.reasonNote) {
      throw new UnprocessableEntityException({
        message: "inventory.note_required",
        args: { field: "reasonNote" },
      });
    }
    if (rules.requiresLinkedWarehouse && !document.linkedWarehouseId) {
      throw new UnprocessableEntityException({
        message: "inventory.linked_warehouse_required",
        args: { field: "linkedWarehouseId" },
      });
    }
    if (rules.requiresUnitCost) {
      const sinCosto = lines.find((l) => l.unitCost === null);
      if (sinCosto !== undefined) {
        throw new UnprocessableEntityException({
          message: "inventory.unit_cost_required",
          args: { field: "unitCost", lineNo: sinCosto.lineNo },
        });
      }
    }
  }
}
