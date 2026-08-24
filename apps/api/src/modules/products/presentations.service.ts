import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { restriccionViolada } from "../../common/prisma/unique-violation";
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
 * 3. **Se borran solo si nadie las usó** (decisión de Carlos, 2026-08-17). Una
 *    presentación recién creada con el factor equivocado se elimina de verdad;
 *    una que ya participó de una venta, no —un ticket que apunta a una
 *    presentación borrada es un agujero en el histórico—, y para esa el camino
 *    es desactivarla. Ver `assertDeletable`.
 * 4. **El producto nunca se queda sin presentación de venta preseleccionada.**
 *    Ese agujero se entra por TRES puertas —quitarle el default, desactivarla,
 *    borrarla— y las tres están tapadas. El POS de F4 no sabría qué ofrecer.
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
        // Mismo orden TOTAL que el detalle del producto (ver `products.service`):
        // si divergieran, la tabla saltaría según qué pantalla la haya cargado.
        orderBy: [{ factor: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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

      // Desactivarla es el MISMO agujero por otra puerta: la marca de default
      // sobreviviría apuntando a una presentación que no se puede vender.
      if (input.isActive === false && current.isDefaultSale) {
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

  /**
   * F2-PRESENT — borrado real, condicionado.
   *
   * El caso que lo motiva: cargar "Bolsa 2 kg" con factor 1000 por error.
   * Desactivarla la dejaría para siempre en la lista, gris, sin haber servido
   * nunca para nada.
   */
  async remove(
    user: AuthUser,
    productId: string,
    presentationId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findProductOrFail(tx, user, productId);

      const current = await tx.productPresentation.findFirst({
        where: { id: presentationId, productId },
        select: { id: true, name: true, isDefaultSale: true },
      });

      if (!current) {
        throw new NotFoundException({ message: "products.presentation_not_found" });
      }

      if (current.isDefaultSale) {
        // Marcar otra como predeterminada primero; recién ahí esta se puede ir.
        throw new ConflictException({ message: "products.default_presentation_required" });
      }

      const total = await tx.productPresentation.count({ where: { productId } });
      if (total <= 1) {
        throw new ConflictException({ message: "products.last_presentation" });
      }

      await this.assertDeletable(tx, presentationId);

      await tx.productPresentation.delete({ where: { id: presentationId } });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "products.presentation_delete",
        resourceType: "product_presentation",
        resourceId: presentationId,
        before: { name: current.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /**
   * ¿Alguien ya usó esta presentación? Punto ÚNICO de extensión: hoy no hay
   * ninguna tabla que la referencie —`stock_by_warehouse` cuelga del producto,
   * no de la presentación—, así que no hay nada que chequear todavía.
   *
   * **F3 y F4 agregan su chequeo ACÁ**, no en el `remove`: los movimientos de
   * inventario y las líneas de venta van a apuntar a `product_presentations`, y
   * a partir de ese momento borrar una usada rompe el histórico. Cuando eso
   * pase, este método lanza 409 `products.presentation_in_use` y la UI ofrece
   * desactivar en lugar de borrar.
   */
  /**
   * F3-GUARDS-01 — una presentación con la que YA se capturó no se borra.
   *
   * El kardex tiene que poder seguir explicando en qué presentación se capturó
   * cada línea ("3 Caja ×12"). Borrarla dejaría movimientos que nadie puede
   * reinterpretar — y por eso la FK de F3-DB-01 es `Restrict`: esto es la
   * puerta amable, el FK es la red.
   *
   * La salida no destructiva existe y el mensaje la nombra: DESACTIVARLA la
   * saca de los formularios sin tocar la historia.
   */
  private async assertDeletable(
    tx: Prisma.TransactionClient,
    presentationId: string,
  ): Promise<void> {
    const movimientos = await tx.stockMovement.count({ where: { presentationId } });
    if (movimientos > 0) {
      throw new ConflictException({ message: "products.presentation_in_use" });
    }
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
  const restriccion = restriccionViolada(error);
  if (restriccion === null) {
    return error;
  }
  if (restriccion.includes("barcode")) {
    return new ConflictException({ message: "products.barcode_taken" });
  }
  return new ConflictException({ message: "products.presentation_name_taken" });
}
