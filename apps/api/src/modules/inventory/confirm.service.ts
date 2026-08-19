import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { REASON_RULES, SELECTABLE_ENTRY_REASONS, SELECTABLE_EXIT_REASONS } from "@sellpoint/shared";
import { type InventoryDocument, Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { type ExpandedLine, expandComposition } from "./composition-expander";
import { DocumentsService } from "./documents.service";
import { resolveLines } from "./line-resolver";
import { resolveLotsFefo } from "./lot-fefo";
import { recordMovementAudit } from "./movement-audit";
import { StockLedgerService } from "./stock-ledger.service";
import { TransfersService } from "./transfers.service";
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
    private readonly transfers: TransfersService,
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

      // 4. El traspaso, ANTES de asentar y de sellar. El orden importa dos
      //    veces: el documento todavía es `draft`, así que el trigger deja
      //    ponerle el `transfer_id`; y si el ledger rechazara por falta de
      //    stock, la transacción entera se deshace y no queda un traspaso
      //    huérfano apuntando a un despacho que nunca salió.
      const transfer =
        reasonCode === "transfer" && direction === "exit"
          ? await this.createTransfer(tx, user, document, conLotes)
          : null;

      // 4-bis. La RECEPCIÓN, también antes de asentar: si el traspaso no está
      //        en tránsito o alguna línea no cuadra, la transacción se deshace
      //        entera y el destino no sube nada. El lock lógico vive adentro.
      const received =
        reasonCode === "transfer" && direction === "entry"
          ? await this.transfers.receive(tx, user, document, conLotes)
          : null;

      // 5. Asentar. Acá es donde el stock se mueve, con las filas bloqueadas.
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

      // 6. Sellar. ÚLTIMO: a partir de acá el trigger congela el documento.
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
        ...(transfer !== null && { transfer: { id: transfer.id } }),
        // La recepción devuelve el folio del DESPACHO: es como el usuario
        // conoce a ese traspaso, no por su uuid.
        ...(received !== null && {
          transfer: {
            id: received.id,
            status: received.status,
            dispatchFolio: received.dispatchFolio,
          },
        }),
      };
    });
  }

  /**
   * Crea el traspaso y sus líneas, y le cuelga el `transfer_id` al documento.
   *
   * El destino se valida ACTIVO y del tenant, pero **no se le exige scope**:
   * un encargado puede despachar hacia un almacén que no administra — de
   * hecho es lo normal, porque el que recibe es otra persona. Lo que sí exige
   * scope es el ORIGEN, que es de donde sale la mercancía.
   *
   * Las líneas se agrupan por (producto, lote) en unidad base: el traspaso
   * viaja en unidades reales, no en las cajas que alguien tecleó, porque
   * quien recibe cuenta lo que llega.
   */
  private async createTransfer(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    document: InventoryDocument,
    lines: ExpandedLine[],
  ) {
    const destinationId = document.linkedWarehouseId;
    if (destinationId === null) {
      throw new UnprocessableEntityException({
        message: "inventory.linked_warehouse_required",
        args: { field: "linkedWarehouseId" },
      });
    }
    if (destinationId === document.warehouseId) {
      throw new UnprocessableEntityException({
        message: "inventory.transfer_same_warehouse",
        args: { field: "linkedWarehouseId" },
      });
    }
    await assertActiveWarehouse(tx, user.tenantId, destinationId);

    const transfer = await tx.transfer.create({
      data: {
        tenantId: user.tenantId,
        originWarehouseId: document.warehouseId,
        destinationWarehouseId: destinationId,
        createdBy: user.userId,
      },
    });

    const porProductoYLote = new Map<
      string,
      { productId: string; lotId: string | null; sent: Prisma.Decimal }
    >();
    for (const line of lines) {
      const key = `${line.productId}|${line.lotId ?? ""}`;
      const previo = porProductoYLote.get(key);
      porProductoYLote.set(key, {
        productId: line.productId,
        lotId: line.lotId ?? null,
        sent: (previo?.sent ?? new Prisma.Decimal(0)).plus(line.quantityBase),
      });
    }

    await tx.transferLine.createMany({
      data: [...porProductoYLote.values()].map((linea) => ({
        tenantId: user.tenantId,
        transferId: transfer.id,
        productId: linea.productId,
        lotId: linea.lotId,
        quantitySent: linea.sent,
      })),
    });

    // El documento todavía es borrador: el trigger permite este UPDATE. Un
    // segundo más tarde, ya confirmado, lo rechazaría con 42501.
    await tx.inventoryDocument.update({
      where: { id: document.id },
      data: { transferId: transfer.id },
    });

    return transfer;
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
    // `transfer` en una ENTRADA no lo puede ELEGIR un humano (por eso no está
    // en `SELECTABLE_ENTRY_REASONS`), pero el borrador de recepción lo lleva
    // legítimamente: lo creó el sistema desde el traspaso. La distinción es
    // "qué se puede elegir" contra "qué es válido", y acá manda la segunda.
    const porRecepcion =
      direction === "entry" && document.reasonCode === "transfer" && document.transferId !== null;

    if (!permitidos.includes(document.reasonCode) && !porRecepcion) {
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
