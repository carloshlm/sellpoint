import { Injectable, NotFoundException } from "@nestjs/common";
import { type InventoryDocumentLine, Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { DocumentsService } from "./documents.service";
import type { ReplaceDocumentLinesDto, UpsertDocumentLineDto } from "./dto/document.dto";

/**
 * F3-DOC-04 — las líneas del borrador.
 *
 * Todo lo de acá es **autoguardado**: cada vez que alguien agrega un producto o
 * corrige una cantidad, se escribe. Por eso guarda **sin validar de fondo** —
 * una línea a medio llenar es un estado legítimo mientras el documento sea
 * borrador, y rechazarla haría perder el trabajo que el borrador vino a
 * proteger. Lo que valida duro es el `confirm`; lo que avisa antes es la previa.
 */
@Injectable()
export class DocumentLinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * Agrega una línea. Si el producto ya está en el borrador **con la misma
   * presentación y el mismo lote**, SUMA en vez de duplicar: es lo que espera
   * quien escanea dos veces el mismo código. Con otra presentación son líneas
   * distintas, porque "2 cajas" y "3 unidades" no se suman sin convertir.
   */
  async add(
    user: AuthUser,
    documentId: string,
    dto: UpsertDocumentLineDto,
  ): Promise<InventoryDocumentLine> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.documents.assertDraft(tx, user.tenantId, documentId);

      // Sin presentación EXPLÍCITA (undefined, no null), la línea nace con la
      // de factor 1 del producto: matemáticamente neutra (cantidad × 1), pero
      // bien nombrada y con `allowFractionalInput` aplicando — el camino null
      // esquivaba la regla de enteros y duplicaba la opción en el selector.
      // `null` explícito sigue siendo la unidad base: el default es solo para
      // lo que el cliente no dijo.
      let presentationId = dto.presentationId ?? null;
      if (dto.presentationId === undefined) {
        const base = await tx.productPresentation.findFirst({
          where: { productId: dto.productId, factor: 1, isActive: true },
          orderBy: { isDefaultSale: "desc" },
          select: { id: true },
        });
        presentationId = base?.id ?? null;
      }

      const existente = await tx.inventoryDocumentLine.findFirst({
        where: {
          documentId,
          productId: dto.productId,
          presentationId,
          lotCode: dto.lotCode ?? null,
        },
      });

      if (existente !== null) {
        const suma =
          dto.quantity === undefined || dto.quantity === null
            ? existente.quantity
            : new Prisma.Decimal((existente.quantity ?? 0).toString()).plus(dto.quantity);
        return tx.inventoryDocumentLine.update({
          where: { id: existente.id },
          data: { quantity: suma },
        });
      }

      // El `lineNo` es lo que el usuario ve en el papel, así que arranca en 1 y
      // no se reusa: quitar la línea 2 deja 1 y 3, y eso es correcto.
      const ultimo = await tx.inventoryDocumentLine.aggregate({
        where: { documentId },
        _max: { lineNo: true },
      });

      return tx.inventoryDocumentLine.create({
        data: {
          tenantId: user.tenantId,
          documentId,
          lineNo: (ultimo._max.lineNo ?? 0) + 1,
          productId: dto.productId,
          presentationId,
          quantity: dto.quantity ?? null,
          unitCost: dto.unitCost ?? null,
          lotCode: dto.lotCode ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          location: dto.location ?? null,
          counted: dto.counted ?? null,
        },
      });
    });
  }

  async update(
    user: AuthUser,
    documentId: string,
    lineId: string,
    dto: Partial<UpsertDocumentLineDto>,
  ): Promise<InventoryDocumentLine> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.documents.assertDraft(tx, user.tenantId, documentId);

      const linea = await tx.inventoryDocumentLine.findFirst({ where: { id: lineId, documentId } });
      if (linea === null) {
        throw new NotFoundException({ message: "inventory.document_line_not_found" });
      }

      return tx.inventoryDocumentLine.update({
        where: { id: lineId },
        data: {
          ...(dto.presentationId !== undefined && { presentationId: dto.presentationId ?? null }),
          ...(dto.quantity !== undefined && { quantity: dto.quantity ?? null }),
          ...(dto.unitCost !== undefined && { unitCost: dto.unitCost ?? null }),
          ...(dto.lotCode !== undefined && { lotCode: dto.lotCode ?? null }),
          ...(dto.expiresAt !== undefined && {
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          }),
          ...(dto.location !== undefined && { location: dto.location ?? null }),
          ...(dto.counted !== undefined && { counted: dto.counted ?? null }),
        },
      });
    });
  }

  async remove(user: AuthUser, documentId: string, lineId: string): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.documents.assertDraft(tx, user.tenantId, documentId);
      await tx.inventoryDocumentLine.deleteMany({ where: { id: lineId, documentId } });
    });
  }

  /**
   * Reemplazo masivo: lo que usa el pegado desde una planilla y la importación
   * en modo `replace`. Borra y reescribe en la MISMA transacción para que
   * nadie vea el borrador vacío en el medio.
   */
  async replace(
    user: AuthUser,
    documentId: string,
    dto: ReplaceDocumentLinesDto,
  ): Promise<InventoryDocumentLine[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.documents.assertDraft(tx, user.tenantId, documentId);
      await tx.inventoryDocumentLine.deleteMany({ where: { documentId } });

      if (dto.lines.length === 0) {
        return [];
      }

      await tx.inventoryDocumentLine.createMany({
        data: dto.lines.map((line, index) => ({
          tenantId: user.tenantId,
          documentId,
          lineNo: index + 1,
          productId: line.productId,
          presentationId: line.presentationId ?? null,
          quantity: line.quantity ?? null,
          unitCost: line.unitCost ?? null,
          lotCode: line.lotCode ?? null,
          expiresAt: line.expiresAt ? new Date(line.expiresAt) : null,
          location: line.location ?? null,
          counted: line.counted ?? null,
        })),
      });

      return tx.inventoryDocumentLine.findMany({
        where: { documentId },
        orderBy: { lineNo: "asc" },
      });
    });
  }
}
