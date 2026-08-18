import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { FOLIO_PREFIXES, type InventoryDocumentType } from "@sellpoint/shared";
import type { InventoryDocument, Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { nextFolio } from "./folio";

export interface CreateDraftInput {
  type: InventoryDocumentType;
  warehouseId: string;
}

/**
 * F3-DOC-03 — el ciclo de vida del documento: `draft → confirmed | canceled`.
 *
 * Quién lo CONFIRMA no vive acá: cada tipo valida distinto (una entrada por
 * factura exige costo unitario, una salida exige stock, un conteo exige
 * `inventory:manage`), así que el `confirm` es de F3-ENTRY-01, F3-EXIT-01 y
 * F3-COUNT-03. Lo que sí es común —y por eso está acá— es el sellado en sí:
 * `markConfirmed`.
 */
@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea el encabezado vacío con su folio y lo devuelve para que la pantalla
   * navegue a él.
   *
   * ── Por qué una transacción CORTA y propia ───────────────────────────────
   *
   * `nextFolio` toma el lock de la fila `(tenant, serie)` y no lo suelta hasta
   * el COMMIT. Si el folio se pidiera dentro de la transacción del ledger, ese
   * lock quedaría tomado durante TODO el posteo —resolver líneas, bloquear
   * saldos, insertar movimientos— y cualquier otra persona creando un
   * documento de la misma serie esperaría todo eso. Acá la transacción hace
   * dos INSERT y termina: el lock dura milisegundos.
   *
   * Es también lo que permite retomar un movimiento por su folio: el número
   * existe desde el primer momento, no desde que se confirma.
   */
  async createDraft(user: AuthUser, input: CreateDraftInput): Promise<InventoryDocument> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const folio = await nextFolio(tx, user.tenantId, input.type, FOLIO_PREFIXES[input.type]);

      return tx.inventoryDocument.create({
        data: {
          tenantId: user.tenantId,
          folio,
          type: input.type,
          warehouseId: input.warehouseId,
          createdBy: user.userId,
        },
      });
    });
  }

  /**
   * Sella el documento. Lo llama cada `confirm` DENTRO de su transacción, con
   * los movimientos ya insertados.
   *
   * ── El lock lógico ───────────────────────────────────────────────────────
   *
   * `UPDATE … WHERE id = ? AND status = 'draft'` y exigir que haya afectado
   * una fila. La alternativa —leer el estado y después actualizar— deja una
   * ventana entre las dos consultas: dos personas confirmando el mismo
   * borrador desde dos pantallas leerían `draft` las dos y el saldo se sumaría
   * dos veces. Acá la condición viaja DENTRO del UPDATE, así que Postgres la
   * evalúa sobre la fila ya bloqueada.
   *
   * El trigger de F3-DOC-02 es la red de atrás: si esto fallara, un UPDATE
   * sobre un documento ya confirmado revienta con 42501.
   */
  async markConfirmed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentId: string,
    userId: string,
  ): Promise<InventoryDocument> {
    const [confirmed] = await tx.$queryRaw<InventoryDocument[]>`
      UPDATE inventory_documents
      SET status = 'confirmed', confirmed_by = ${userId}::uuid, confirmed_at = now(), updated_at = now()
      WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'draft'
      RETURNING id, folio, type, status, confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt"`;

    if (confirmed === undefined) {
      // O no existe, o alguien lo cerró primero. Las dos son 409 para el
      // usuario: "esto ya no es un borrador", y la pantalla se refresca.
      throw new ConflictException({ message: "inventory.document_not_draft" });
    }

    return confirmed;
  }

  /**
   * Anula un borrador. **El folio se queda con él**: la serie no pierde
   * números y quien audita puede explicar cada uno. Anular un confirmado no
   * existe — eso se corrige registrando otro movimiento.
   */
  async cancel(user: AuthUser, documentId: string, reason?: string): Promise<InventoryDocument> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      // Verifica pertenencia Y estado. El update de abajo va sin `tenantId`
      // porque esta línea ya probó que el documento es de este tenant, dentro
      // de la misma transacción.
      await this.assertDraft(tx, user.tenantId, documentId);

      return tx.inventoryDocument.update({
        where: { id: documentId },
        data: {
          status: "canceled",
          canceledBy: user.userId,
          canceledAt: new Date(),
          cancelReason: reason ?? null,
        },
      });
    });
  }

  /**
   * Guarda para todo lo que solo se puede hacer sobre un borrador (agregar
   * líneas, importar un Excel, editar la cabecera). Devuelve el documento para
   * que el llamador no lo relea.
   */
  async assertDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentId: string,
  ): Promise<InventoryDocument> {
    // `tenantId` en el WHERE **además** de la RLS, que es el molde del resto de
    // los services (ver `warehouses.service.ts`). No es redundancia: la RLS de
    // estas tablas llega recién en F3-DB-04, y un test de este archivo probó
    // que sin este filtro un usuario de otro tenant podía anular el documento
    // ajeno. Aunque estuviera puesta, apoyarse en UNA sola barrera para el
    // aislamiento es exactamente lo que no queremos.
    const document = await tx.inventoryDocument.findFirst({
      where: { id: documentId, tenantId },
    });

    if (document === null) {
      throw new NotFoundException({ message: "inventory.document_not_found" });
    }
    if (document.status !== "draft") {
      throw new ConflictException({ message: "inventory.document_not_draft" });
    }

    return document;
  }
}
