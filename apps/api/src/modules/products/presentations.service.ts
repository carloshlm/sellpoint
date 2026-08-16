import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { CreatePresentationDto, UpdatePresentationDto } from "./dto/upsert-presentation.dto";
import { derivesFractionalInput } from "./products.service";

/**
 * F2-PRESENT-01 — cómo se compra y cómo se vende un producto.
 *
 * Tres invariantes que el service defiende y la DB no puede:
 *
 * 1. **`allowFractionalInput` lo DERIVA el server** de la categoría de la
 *    unidad base (`count` → solo enteros). No se confía en lo que mande el
 *    cliente salvo que lo mande explícito como override — si el default
 *    viajara desde el front, dos clientes distintos crearían presentaciones
 *    con reglas distintas para el mismo producto.
 * 2. **`isDefaultSale` es exclusivo por producto**: marcar una desmarca la
 *    anterior en la misma transacción. Dos predeterminadas dejarían al POS
 *    eligiendo al azar.
 * 3. **No se borran, se desactivan**: F4 va a referenciarlas desde las líneas
 *    de venta, y un ticket que apunta a una presentación borrada es un
 *    agujero en el histórico.
 */
@Injectable()
export class PresentationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(user: AuthUser, productId: string) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findProductOrFail(tx, user, productId);
      return tx.productPresentation.findMany({
        where: { productId },
        orderBy: { factor: "asc" },
      });
    });
  }

  async create(user: AuthUser, productId: string, input: CreatePresentationDto, meta: RequestMeta) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const product = await this.findProductOrFail(tx, user, productId);

      try {
        if (input.isDefaultSale) {
          await this.clearDefault(tx, productId);
        }

        const presentation = await tx.productPresentation.create({
          data: {
            tenantId: user.tenantId,
            productId,
            name: input.name,
            factor: input.factor,
            isPurchasable: input.isPurchasable,
            isSellable: input.isSellable,
            isDefaultSale: input.isDefaultSale,
            // Override explícito o derivado de la unidad base del producto.
            allowFractionalInput:
              input.allowFractionalInput ?? derivesFractionalInput(product.baseUnit),
            barcode: input.barcode ?? null,
            price: input.price ?? null,
            cost: input.cost ?? null,
          },
        });

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "products.presentation_create",
          resourceType: "product_presentation",
          resourceId: presentation.id,
          after: { productId, name: presentation.name },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return presentation;
      } catch (error) {
        throw translateUniqueViolation(error);
      }
    });
  }

  async update(
    user: AuthUser,
    productId: string,
    presentationId: string,
    input: UpdatePresentationDto,
    meta: RequestMeta,
  ) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findProductOrFail(tx, user, productId);
      const current = await tx.productPresentation.findFirst({
        where: { id: presentationId, productId, tenantId: user.tenantId },
      });

      if (!current) {
        throw new NotFoundException({ message: "products.presentation_not_found" });
      }

      // Quitarle el default al ÚNICO default dejaría al producto sin
      // presentación preseleccionada y el POS no sabría qué ofrecer.
      if (input.isDefaultSale === false && current.isDefaultSale) {
        throw new ConflictException({ message: "products.default_presentation_required" });
      }

      try {
        if (input.isDefaultSale === true && !current.isDefaultSale) {
          await this.clearDefault(tx, productId);
        }

        const presentation = await tx.productPresentation.update({
          where: { id: presentationId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.factor !== undefined ? { factor: input.factor } : {}),
            ...(input.isPurchasable !== undefined ? { isPurchasable: input.isPurchasable } : {}),
            ...(input.isSellable !== undefined ? { isSellable: input.isSellable } : {}),
            ...(input.isDefaultSale !== undefined ? { isDefaultSale: input.isDefaultSale } : {}),
            ...(input.allowFractionalInput !== undefined
              ? { allowFractionalInput: input.allowFractionalInput }
              : {}),
            ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
            ...(input.price !== undefined ? { price: input.price } : {}),
            ...(input.cost !== undefined ? { cost: input.cost } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "products.presentation_update",
          resourceType: "product_presentation",
          resourceId: presentationId,
          before: { name: current.name, isActive: current.isActive },
          after: { name: presentation.name, isActive: presentation.isActive },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return presentation;
      } catch (error) {
        throw translateUniqueViolation(error);
      }
    });
  }

  private async clearDefault(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    await tx.productPresentation.updateMany({
      where: { productId, isDefaultSale: true },
      data: { isDefaultSale: false },
    });
  }

  private async findProductOrFail(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    productId: string,
  ): Promise<{ id: string; baseUnit: string }> {
    const product = await tx.product.findFirst({
      where: { id: productId, tenantId: user.tenantId },
      select: { id: true, baseUnit: true },
    });

    if (!product) {
      throw new NotFoundException({ message: "products.not_found" });
    }

    return product;
  }
}

/**
 * Dos unique distintos con mensajes distintos: repetir el NOMBRE dentro de un
 * producto no es lo mismo que repetir un CÓDIGO DE BARRAS en todo el negocio,
 * y el usuario necesita saber cuál de los dos le pasó.
 */
function translateUniqueViolation(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = String(error.meta?.target ?? "");
    if (target.includes("barcode")) {
      return new ConflictException({ message: "products.barcode_taken" });
    }
    return new ConflictException({ message: "products.presentation_name_taken" });
  }
  return error;
}
