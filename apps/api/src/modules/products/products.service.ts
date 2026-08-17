import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getUnit } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";
import { PRODUCTS_CATALOG_KEY } from "../tenants/role-catalog";
import type {
  CreateProductDto,
  ListProductsQuery,
  UpdateProductDto,
} from "./dto/upsert-product.dto";

/**
 * Nombre de la presentación base que se crea con cada producto. Es la que
 * lleva el precio y el costo que el usuario carga en el form del catálogo
 * (decisión de Carlos, 2026-08-16): el precio vive en `product_presentations`,
 * una sola fuente de verdad, pero se edita desde la misma pantalla.
 */
export const BASE_PRESENTATION_NAME = "Unidad";

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  isComposite: boolean;
  isActive: boolean;
  attributes: unknown;
  price: string | null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * F2-PROD-02. Búsqueda por SKU, nombre y **códigos de barras de cualquier
   * presentación** — el mostrador escanea una caja y tiene que aparecer el
   * producto. `contains` genera ILIKE, que el índice trigram de F2-DB-04 sabe
   * usar. Paginación SERVER-SIDE: un catálogo son miles de filas, no la
   * lista corta de usuarios que se filtra en cliente.
   */
  async list(
    user: AuthUser,
    query: ListProductsQuery,
    attributeFilters: Record<string, string> = {},
  ) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const needle = query.query?.trim();

      const where: Prisma.ProductWhereInput = {
        ...(query.composite !== undefined ? { isComposite: query.composite === "true" } : {}),
        ...(needle
          ? {
              OR: [
                { sku: { contains: needle, mode: "insensitive" } },
                { name: { contains: needle, mode: "insensitive" } },
                {
                  presentations: {
                    some: { barcode: { contains: needle, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {}),
        AND: Object.entries(attributeFilters).map(([key, value]) => ({
          attributes: { path: [key], equals: value },
        })),
      };

      const [total, products] = await Promise.all([
        tx.product.count({ where }),
        tx.product.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            presentations: {
              where: { isDefaultSale: true },
              select: { price: true },
              take: 1,
            },
          },
        }),
      ]);

      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          baseUnit: product.baseUnit,
          isComposite: product.isComposite,
          isActive: product.isActive,
          attributes: product.attributes,
          // El precio que se lista es el de la presentación PREDETERMINADA:
          // es la que el POS preselecciona al vender.
          price: product.presentations[0]?.price?.toString() ?? null,
        })),
      };
    });
  }

  async findOne(user: AuthUser, id: string) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, tenantId: user.tenantId },
        // `factor` a secas NO define un orden: dos presentaciones pueden
        // empatar (pasa apenas alguien carga mal una equivalencia) y ahí
        // Postgres devuelve lo que le conviene, que CAMBIA después de un
        // UPDATE porque la fila se reubica. El resultado era una tabla que
        // saltaba al tocar un checkbox. `createdAt` desempata por orden de
        // alta; el `id` cierra el caso de las creadas en la MISMA transacción
        // —`now()` es el del inicio de la transacción, así que la importación
        // masiva las deja con el mismo timestamp al microsegundo—.
        include: {
          presentations: { orderBy: [{ factor: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
        },
      });

      if (!product) {
        throw new NotFoundException({ message: "products.not_found" });
      }

      return product;
    });
  }

  async create(user: AuthUser, input: CreateProductDto, meta: RequestMeta) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.assertAttributesValid(tx, user, input.attributes);
      assertKnownUnit(input.baseUnit);

      try {
        const product = await tx.product.create({
          data: {
            tenantId: user.tenantId,
            sku: input.sku,
            name: input.name,
            baseUnit: input.baseUnit,
            stockMin: input.stockMin,
            isComposite: input.isComposite,
            attributes: input.attributes as Prisma.InputJsonValue,
          },
        });

        // Presentación base «Unidad ×1»: sin ella el producto no tendría dónde
        // guardar su precio ni podría venderse en el POS. El usuario nunca la
        // crea a mano — la ve como "el precio del producto".
        await tx.productPresentation.create({
          data: {
            tenantId: user.tenantId,
            productId: product.id,
            name: BASE_PRESENTATION_NAME,
            factor: 1,
            isPurchasable: true,
            isSellable: true,
            isDefaultSale: true,
            allowFractionalInput: derivesFractionalInput(input.baseUnit),
            price: input.price ?? null,
            cost: input.cost ?? null,
          },
        });

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "products.create",
          resourceType: "product",
          resourceId: product.id,
          after: { sku: product.sku, name: product.name },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return product;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "products.sku_taken" });
        }
        throw error;
      }
    });
  }

  async update(user: AuthUser, id: string, input: UpdateProductDto, meta: RequestMeta) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, tenantId: user.tenantId } });

      if (!current) {
        throw new NotFoundException({ message: "products.not_found" });
      }

      if (input.attributes !== undefined) {
        await this.assertAttributesValid(tx, user, input.attributes);
      }

      if (input.baseUnit !== undefined && input.baseUnit !== current.baseUnit) {
        assertKnownUnit(input.baseUnit);
        await this.assertBaseUnitChangeable(tx, id);
      }

      try {
        const product = await tx.product.update({
          where: { id },
          data: {
            ...(input.sku !== undefined ? { sku: input.sku } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.baseUnit !== undefined ? { baseUnit: input.baseUnit } : {}),
            ...(input.stockMin !== undefined ? { stockMin: input.stockMin } : {}),
            ...(input.isComposite !== undefined ? { isComposite: input.isComposite } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            ...(input.attributes !== undefined
              ? { attributes: input.attributes as Prisma.InputJsonValue }
              : {}),
          },
        });

        // Precio y costo editan la presentación PREDETERMINADA: para el
        // usuario son "el precio del producto", para el modelo son la fila
        // base. Un solo lugar donde vive el número.
        if (input.price !== undefined || input.cost !== undefined) {
          const target = await tx.productPresentation.findFirst({
            where: { productId: id, isDefaultSale: true },
            select: { id: true },
          });
          if (target) {
            await tx.productPresentation.update({
              where: { id: target.id },
              data: {
                ...(input.price !== undefined ? { price: input.price } : {}),
                ...(input.cost !== undefined ? { cost: input.cost } : {}),
              },
            });
          }
        }

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "products.update",
          resourceType: "product",
          resourceId: id,
          before: { sku: current.sku, name: current.name },
          after: { sku: product.sku, name: product.name },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return product;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "products.sku_taken" });
        }
        throw error;
      }
    });
  }

  /**
   * F2-PROD-03. Borrar está bloqueado si el producto es COMPONENTE de otro:
   * la FK es RESTRICT, pero se chequea antes para poder decir de QUIÉNES es
   * componente en vez de devolver un error de constraint (ARQUITECTURA § 3.5,
   * validación #3). La alternativa que ofrece la UI es desactivarlo.
   */
  async remove(user: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, tenantId: user.tenantId } });

      if (!current) {
        throw new NotFoundException({ message: "products.not_found" });
      }

      const parents = await tx.productComposition.findMany({
        where: { componentProductId: id },
        select: { parent: { select: { sku: true, name: true } } },
        take: 5,
      });

      if (parents.length > 0) {
        throw new ConflictException({
          message: "products.is_component",
          usedBy: parents.map((row) => row.parent),
        });
      }

      await tx.product.delete({ where: { id } });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "products.delete",
        resourceType: "product",
        resourceId: id,
        before: { sku: current.sku, name: current.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /**
   * Cambiar la unidad base es ambiguo si ya hay existencias (¿los 500 que hay
   * eran gramos o kilos?) o si el producto es componente de otro (su receta
   * está expresada en la unidad vieja) — ARQUITECTURA § 3.5, validación #2.
   */
  private async assertBaseUnitChangeable(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const [withStock, usedAsComponent] = await Promise.all([
      tx.stockByWarehouse.count({ where: { productId, quantity: { gt: 0 } } }),
      tx.productComposition.count({ where: { componentProductId: productId } }),
    ]);

    if (withStock > 0) {
      throw new ConflictException({ message: "products.base_unit_locked_by_stock" });
    }
    if (usedAsComponent > 0) {
      throw new ConflictException({ message: "products.base_unit_locked_by_composition" });
    }
  }

  private async assertAttributesValid(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    attributes: Record<string, unknown>,
  ): Promise<void> {
    const catalog = await tx.catalog.findFirst({
      where: { tenantId: user.tenantId, systemKey: PRODUCTS_CATALOG_KEY },
      select: { id: true },
    });

    if (!catalog) {
      // Un tenant sin catálogo de productos no debería existir (F2-CAT-01 +
      // backfill). Si pasa, es mejor fallar fuerte que aceptar cualquier cosa.
      throw new ConflictException({ message: "products.catalog_missing" });
    }

    const fields: FieldDefinition[] = await tx.catalogField.findMany({
      where: { catalogId: catalog.id },
      select: {
        key: true,
        fieldType: true,
        required: true,
        isArchived: true,
        lookupCatalogId: true,
      },
    });

    const errors = validateRecordAttributes(fields, attributes);
    if (errors.length > 0) {
      throw new BadRequestException({ message: "products.invalid_attributes", errors });
    }

    // Existencia real de cada destino de lookup: la DB no puede garantizarla
    // porque es un UUID dentro de un JSONB.
    for (const field of fields) {
      if (field.isArchived || field.fieldType !== "lookup" || !field.lookupCatalogId) {
        continue;
      }
      const value = attributes[field.key];
      if (typeof value !== "string") {
        continue;
      }
      const target = await tx.catalogRecord.findFirst({
        where: {
          id: value,
          catalogId: field.lookupCatalogId,
          tenantId: user.tenantId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!target) {
        throw new BadRequestException({
          message: "products.invalid_attributes",
          errors: [{ key: field.key, message: "catalogs.lookup_value_not_found" }],
        });
      }
    }
  }
}

/**
 * `count` (cosas que se cuentan de a una) no admite decimales; el resto sí.
 * El TenantAdmin puede sobrescribirlo por presentación (F2-PRESENT).
 */
export function derivesFractionalInput(baseUnit: string): boolean {
  return getUnit(baseUnit)?.category !== "count";
}

function assertKnownUnit(code: string): void {
  if (!getUnit(code)) {
    // La FK de la DB también lo rechazaría, pero con un error de constraint
    // ilegible. Acá se sabe qué unidad pidió el cliente.
    throw new BadRequestException({ message: "products.unknown_unit" });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
