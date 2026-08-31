import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getUnit, type Locale, unitName } from "@sellpoint/shared";
import { restriccionViolada } from "../../common/prisma/unique-violation";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { assertSystemCatalogAttributes } from "../catalogs/attribute-assertions";
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
 *
 * Se llama como la UNIDAD BASE, no "Unidad" a secas (corrección de Carlos,
 * 2026-08-17): un producto en gramos mostraba una presentación llamada
 * "Unidad" que en realidad valía 1 gramo, y eso confunde justo donde no
 * conviene. Va en el idioma de quien crea el producto porque es un dato del
 * tenant —editable, como cualquier otro nombre de presentación—, no una
 * etiqueta que se traduzca al vuelo.
 */
export function basePresentationName(baseUnit: string, locale: Locale): string {
  return unitName(baseUnit, locale);
}

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

      // Lo necesita el FORMULARIO: sin esto el checkbox de "controla lotes" no
      // sabe si tiene que ir deshabilitado, y el usuario se enteraría con un
      // 409 después de intentarlo — explicar tarde algo que la pantalla podía
      // decir de entrada.
      const lotStock = await tx.stockLot.count({
        where: { quantity: { gt: 0 }, lot: { productId: id } },
      });

      return { ...product, hasLotStock: lotStock > 0 };
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
            location: input.location ?? null,
            isComposite: input.isComposite,
            tracksLots: input.tracksLots,
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
            name: basePresentationName(input.baseUnit, user.locale),
            factor: 1,
            isPurchasable: true,
            isSellable: true,
            isDefaultSale: true,
            allowFractionalInput: derivesFractionalInput(input.baseUnit),
            price: input.price ?? null,
            cost: input.cost ?? null,
            barcode: input.barcode ?? null,
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
        throw traducirConflicto(error);
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

      // Solo al APAGARLO. Encenderlo siempre se puede: el saldo previo queda
      // "sin lote" y se asigna después por inventario físico.
      if (input.tracksLots === false && current.tracksLots) {
        await this.assertLotsCanBeDisabled(tx, id);
      }

      // Mismo criterio con el producto entero: apagar algo que todavía tiene
      // existencias exige sacarlas antes. REACTIVAR nunca pide nada.
      if (input.isActive === false && current.isActive) {
        await this.assertCanBeDeactivated(tx, user.tenantId, id);
      }

      try {
        const product = await tx.product.update({
          where: { id },
          data: {
            ...(input.sku !== undefined ? { sku: input.sku } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.baseUnit !== undefined ? { baseUnit: input.baseUnit } : {}),
            ...(input.stockMin !== undefined ? { stockMin: input.stockMin } : {}),
            ...(input.location !== undefined ? { location: input.location } : {}),
            ...(input.isComposite !== undefined ? { isComposite: input.isComposite } : {}),
            ...(input.tracksLots !== undefined ? { tracksLots: input.tracksLots } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            ...(input.attributes !== undefined
              ? { attributes: input.attributes as Prisma.InputJsonValue }
              : {}),
          },
        });

        // Precio, costo y código de barras editan la presentación
        // PREDETERMINADA: para el usuario son "del producto", para el modelo
        // son la fila base. Un solo lugar donde vive cada dato.
        if (input.price !== undefined || input.cost !== undefined || input.barcode !== undefined) {
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
                ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
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
        throw traducirConflicto(error);
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

      // F3-GUARDS-02: con historia detrás, un producto NO se borra. El kardex
      // lo referencia y el histórico no se reescribe (las FK son `Restrict`);
      // esta es la puerta amable y el FK es la red. La salida no destructiva
      // es DESACTIVARLO: deja de ofrecerse sin borrar lo que pasó.
      //
      // Cuenta las cuatro formas de tener historia: movimientos propios,
      // movimientos donde fue el COMPUESTO que se expandió, líneas de traspaso
      // y lotes registrados.
      const [movimientos, comoCompuesto, enTraspasos, lotes] = await Promise.all([
        tx.stockMovement.count({ where: { productId: id } }),
        tx.stockMovement.count({ where: { parentProductId: id } }),
        tx.transferLine.count({ where: { productId: id } }),
        tx.productLot.count({ where: { productId: id } }),
      ]);
      if (movimientos + comoCompuesto + enTraspasos + lotes > 0) {
        throw new ConflictException({ message: "products.has_movements" });
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
   * eran gramos o kilos?) o si el producto es componente de otro (su composición
   * está expresada en la unidad vieja) — ARQUITECTURA § 3.5, validación #2.
   */
  /**
   * Apagar el control de lote con saldo dejaría las filas de `stock_lots`
   * huérfanas y rompería la invariante `Σ stock_lots == stock_by_warehouse`
   * que el ledger sostiene. El saldo no desaparece: simplemente ya nadie
   * sabría a qué lote pertenece.
   *
   * El 409 lleva el DETALLE por lote a propósito. "No se puede apagar" a secas
   * deja a quien lo intenta sin saber qué mover para poder hacerlo; con el
   * listado sabe exactamente qué sacar o consumir primero.
   *
   * Un lote en CERO no estorba: lo que bloquea es el saldo, no el registro
   * histórico del lote (que además no se borra nunca — los movimientos lo
   * referencian).
   */
  /**
   * Un producto inactivo con saldo es **inventario fantasma**: la plantilla
   * del conteo físico excluye los inactivos, así que ese stock deja de
   * aparecer en el inventario — nadie lo cuenta, nadie lo ajusta, y el
   * almacén tiene mercancía que el sistema ya no menciona (Carlos,
   * 2026-08-29; en sandbox había uno con 285.5 unidades en dos almacenes).
   *
   * Se rechaza con CUALQUIER saldo distinto de cero, negativos incluidos: un
   * negativo es una deuda de inventario por resolver, y desactivar el
   * producto la volvería invisible para siempre.
   *
   * La respuesta nombra los almacenes y sus cantidades porque sin saber
   * DÓNDE está, el usuario no sabe qué salida capturar para poder apagarlo.
   */
  private async assertCanBeDeactivated(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
  ): Promise<void> {
    const conSaldo = await tx.stockByWarehouse.findMany({
      where: { tenantId, productId, NOT: { quantity: 0 } },
      select: { quantity: true, warehouse: { select: { name: true } } },
      orderBy: { warehouse: { name: "asc" } },
    });

    if (conSaldo.length === 0) {
      return;
    }

    throw new ConflictException({
      message: "products.stock_in_warehouses",
      // `args` alimenta la interpolación del mensaje; sin esto la pantalla
      // mostraría "{count}" literal — y un test que solo mira el `code` no
      // lo vería.
      args: { count: conSaldo.length },
      warehouses: conSaldo.map((row) => ({
        name: row.warehouse.name,
        quantity: row.quantity.toString(),
      })),
    });
  }

  private async assertLotsCanBeDisabled(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const conSaldo = await tx.stockLot.findMany({
      where: { quantity: { gt: 0 }, lot: { productId } },
      select: { quantity: true, lot: { select: { lotCode: true } } },
      orderBy: { lot: { lotCode: "asc" } },
    });

    if (conSaldo.length === 0) {
      return;
    }

    throw new ConflictException({
      message: "products.lots_in_stock",
      lots: conSaldo.map((row) => ({
        lotCode: row.lot.lotCode,
        quantity: row.quantity.toString(),
      })),
    });
  }

  private async assertBaseUnitChangeable(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const [withStock, usedAsComponent, movimientos] = await Promise.all([
      tx.stockByWarehouse.count({ where: { productId, quantity: { gt: 0 } } }),
      tx.productComposition.count({ where: { componentProductId: productId } }),
      tx.stockMovement.count({ where: { productId } }),
    ]);

    // Con historia la unidad queda fija AUNQUE el saldo esté en cero: los
    // movimientos se escribieron EN esa unidad, y reinterpretarlos cambiaría
    // números ya asentados sin tocar una fila.
    if (movimientos > 0) {
      throw new ConflictException({ message: "products.base_unit_locked_by_movements" });
    }
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
    // Delegado al helper compartido del motor (2026-08-26): la misma
    // validación que corren almacenes, servicios y los registros de
    // subcatálogo, con las claves de error de ESTE módulo.
    await assertSystemCatalogAttributes(tx, user, PRODUCTS_CATALOG_KEY, attributes, {
      invalid: "products.invalid_attributes",
      catalogMissing: "products.catalog_missing",
    });
  }
}

/**
 * `count` (cosas que se cuentan de a una) no admite decimales; el resto sí.
 * El Admin puede sobrescribirlo por presentación (F2-PRESENT).
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

/**
 * Traduce una violación de unicidad al conflicto que el usuario puede
 * ARREGLAR. Antes todas caían en `products.sku_taken`, y desde que el alta
 * acepta código de barras (2026-08-24) eso mandaba a buscar el problema donde
 * no estaba: el SKU era único y el repetido era el código.
 *
 * Mismo criterio que `translateUniqueViolation` de `presentations.service`:
 * dos unique distintos, dos mensajes distintos.
 */
function traducirConflicto(error: unknown): unknown {
  const restriccion = restriccionViolada(error);
  if (restriccion === null) {
    return error;
  }
  if (restriccion.includes("barcode")) {
    return new ConflictException({ message: "products.barcode_taken" });
  }
  return new ConflictException({ message: "products.sku_taken" });
}
