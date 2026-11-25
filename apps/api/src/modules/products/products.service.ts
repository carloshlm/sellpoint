import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { barcodeSearchForms, getUnit, normalizeCode } from "@sellpoint/shared";
import { restriccionViolada } from "../../common/prisma/unique-violation";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { EntitlementsService } from "../billing/entitlements.service";
import { assertPlanFeature } from "../billing/plan-required.exception";
import { assertSystemCatalogAttributes } from "../catalogs/attribute-assertions";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";
import { PRODUCTS_CATALOG_KEY } from "../tenants/role-catalog";
import { assertTaxGroupOfTenant } from "../tenants/tax-group-lookup";
import { BarcodeContributionService } from "./barcode-contribution.service";
import { assertBarcodeChange, contributionOf } from "./barcode-rules";
import {
  assertBaseUnitChangeable,
  basePresentationIds,
  basePresentationName,
  derivesFractionalInput,
  followBaseUnitChange,
} from "./base-unit";
import { assertCodeFree, lockCatalogCodes } from "./catalog-codes";
import type {
  CreateProductDto,
  ListProductsQuery,
  UpdateProductDto,
} from "./dto/upsert-product.dto";

// Viven en `base-unit.ts` desde F10-BULK-14; se siguen exportando desde aquí
// porque compras, órdenes de compra y presentaciones los importan de este archivo.
export { basePresentationName, derivesFractionalInput } from "./base-unit";

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
    private readonly entitlements: EntitlementsService,
    private readonly contribution: BarcodeContributionService,
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
                // F10-PRESCODE: el código interno de la presentación también.
                {
                  presentations: {
                    some: { code: { contains: needle, mode: "insensitive" } },
                  },
                },
                // Y el código de barras escrito de otra forma: un UPC-A y su
                // EAN-13 con un cero delante son el mismo código para el lector
                // (`contains` no lo ve: le sobra el cero).
                { presentations: { some: { barcode: { in: barcodeSearchForms(needle) } } } },
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

      const productIds = products.map((product) => product.id);
      const coincidencias = needle
        ? await presentacionesQueCoinciden(tx, productIds, needle)
        : new Map<string, { id: string; name: string }>();
      const presentacionesPorProducto = await presentacionesDeLaPagina(tx, productIds);

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
          taxGroupId: product.taxGroupId,
          attributes: product.attributes,
          // El precio que se lista es el de la presentación PREDETERMINADA:
          // es la que el POS preselecciona al vender.
          price: product.presentations[0]?.price?.toString() ?? null,
          // F10-PRESCODE: la presentación cuyo código de barras o código
          // interno es EXACTAMENTE lo que se buscó. Escanear la bolsa de 10 kg
          // tiene que agregar la bolsa, no el kilo (Carlos, 2026-11-23).
          matchedPresentation: coincidencias.get(product.id) ?? null,
          // F10-BULK-07: el buscador de Entradas, Salidas y Traspasos ofrece
          // cada presentación activa como un botón («Kilogramo · Bolsa 10 Kg»).
          presentations: presentacionesPorProducto.get(product.id) ?? [],
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
      // Compras arma la ficha de un renglón nuevo desde aquí: `isBase` decide
      // si su cantidad lleva el botón de unidad (`basePresentationIds`).
      const bases = await basePresentationIds(tx, [id]);

      return {
        ...product,
        presentations: product.presentations.map((presentation) => ({
          ...presentation,
          isBase: bases.has(presentation.id),
        })),
        hasLotStock: lotStock > 0,
      };
    });
  }

  async create(user: AuthUser, input: CreateProductDto, meta: RequestMeta) {
    // F10-MANFIX-06: dar de alta con lote ES encenderlo, y eso es de Plus.
    if (input.tracksLots) {
      assertPlanFeature(await this.entitlements.resolve(user.tenantId), "lots");
    }

    const creado = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.assertAttributesValid(tx, user, input.attributes);
      assertKnownUnit(input.baseUnit);
      await assertTaxGroupOfTenant(tx, user.tenantId, input.taxGroupId);

      // F10-PRESCODE: el sku y el código de barras no pueden ser el código
      // interno de una presentación (`catalog-codes.ts`).
      await lockCatalogCodes(tx, user.tenantId);
      const nuevo = { productId: null, presentationId: null };
      await assertCodeFree(tx, user.tenantId, input.sku, { como: "sku", ...nuevo });
      if (input.barcode !== undefined) {
        await assertCodeFree(tx, user.tenantId, input.barcode, { como: "barcode", ...nuevo });
      }

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
            taxGroupId: input.taxGroupId ?? null,
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

    // Carlos (2026-10-30): toda alta aporta al catálogo compartido, no solo la
    // Carga rápida. Después del COMMIT y sin lanzar nunca, como allá.
    await this.aportar(user, contributionOf(input.barcode, creado.name, 1));
    return creado;
  }

  async update(user: AuthUser, id: string, input: UpdateProductDto, meta: RequestMeta) {
    // F10-MANFIX-06 — encender el control por lote es de Plus, y el candado
    // mira el CAMBIO, no el valor. El formulario manda la casilla en cada
    // guardado: un producto que ya lleva lote (de cuando el negocio era Plus)
    // se sigue editando sin un 402, y apagarla siempre se puede. Es la LEY de
    // F9-PLANLIST: quien baja de plan conserva lo que ya hizo.
    //
    // El plan se lee ANTES de abrir la transacción: si el caché no lo tiene,
    // `resolve` abre la suya, y anidarla aquí retendría dos conexiones del
    // pool por un solo guardado.
    const plan = input.tracksLots === true ? await this.entitlements.resolve(user.tenantId) : null;

    const hecho = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, tenantId: user.tenantId } });

      if (!current) {
        throw new NotFoundException({ message: "products.not_found" });
      }

      // Precio, costo y código de barras editan la presentación
      // PREDETERMINADA: para el usuario son "del producto", para el modelo
      // son la fila base. Un solo lugar donde vive cada dato.
      const base =
        input.price !== undefined || input.cost !== undefined || input.barcode !== undefined
          ? await tx.productPresentation.findFirst({
              where: { productId: id, isDefaultSale: true },
              select: { id: true, barcode: true, factor: true },
            })
          : null;
      assertBarcodeChange(input.barcode, base?.barcode);

      // F10-PRESCODE: lo que CAMBIA se revisa contra los códigos internos de
      // las presentaciones (`catalog-codes.ts`).
      const cambiaSku = input.sku !== undefined && input.sku !== current.sku;
      const cambiaBarras = input.barcode !== undefined && input.barcode !== (base?.barcode ?? null);
      if (cambiaSku || cambiaBarras) {
        await lockCatalogCodes(tx, user.tenantId);
      }
      if (cambiaSku && input.sku !== undefined) {
        await assertCodeFree(tx, user.tenantId, input.sku, {
          como: "sku",
          productId: id,
          presentationId: null,
        });
      }
      if (cambiaBarras && input.barcode) {
        await assertCodeFree(tx, user.tenantId, input.barcode, {
          como: "barcode",
          productId: id,
          presentationId: base?.id ?? null,
        });
      }

      if (plan !== null && !current.tracksLots) {
        assertPlanFeature(plan, "lots");
      }

      if (input.attributes !== undefined) {
        await this.assertAttributesValid(tx, user, input.attributes);
      }
      if (input.taxGroupId !== undefined) {
        await assertTaxGroupOfTenant(tx, user.tenantId, input.taxGroupId);
      }

      const cambiaUnidad = input.baseUnit !== undefined && input.baseUnit !== current.baseUnit;
      if (cambiaUnidad && input.baseUnit !== undefined) {
        assertKnownUnit(input.baseUnit);
        await assertBaseUnitChangeable(tx, id);
      }

      // Solo al APAGARLO. Encenderlo no depende del saldo —el previo queda
      // "sin lote" y se asigna después por inventario físico—, solo del plan.
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
            ...(input.taxGroupId !== undefined ? { taxGroupId: input.taxGroupId } : {}),
            ...(input.attributes !== undefined
              ? { attributes: input.attributes as Prisma.InputJsonValue }
              : {}),
          },
        });

        // F10-BULK-14: la presentación base sigue a la unidad (`base-unit.ts`).
        if (cambiaUnidad && input.baseUnit !== undefined) {
          await followBaseUnitChange(tx, id, {
            from: current.baseUnit,
            to: input.baseUnit,
            locale: user.locale,
          });
        }

        if (base) {
          await tx.productPresentation.update({
            where: { id: base.id },
            data: {
              ...(input.price !== undefined ? { price: input.price } : {}),
              ...(input.cost !== undefined ? { cost: input.cost } : {}),
              ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
            },
          });
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

        // Solo un código NUEVO se aporta: reenviar el de siempre no es aporte.
        const cambio =
          base !== null && input.barcode !== undefined && input.barcode !== base.barcode;
        return {
          product,
          aporte: cambio ? contributionOf(input.barcode, product.name, base.factor) : null,
        };
      } catch (error) {
        throw traducirConflicto(error);
      }
    });

    await this.aportar(user, hecho.aporte);
    return hecho.product;
  }

  /** El aporte al catálogo compartido, si lo hay. `contribute` no lanza nunca. */
  private async aportar(user: AuthUser, aporte: ReturnType<typeof contributionOf>): Promise<void> {
    if (aporte !== null) {
      await this.contribution.contribute(user.tenantId, user.locale, [aporte]);
    }
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
  const clave = claveDeConflicto(error);
  return clave === null ? error : new ConflictException({ message: clave });
}

/**
 * La CLAVE del conflicto, sin envolverla en una excepción.
 *
 * La carga rápida (F10-QUICKCAT-04) necesita el mismo veredicto pero para
 * pegarlo a una LÍNEA, no para lanzarlo: un 409 suelto en medio de un lote de
 * 60 productos no dice cuál falló. Devuelve `null` si el error no es una
 * violación de unicidad, y entonces no es asunto de esta traducción.
 */
export function claveDeConflicto(error: unknown): string | null {
  const restriccion = restriccionViolada(error);
  if (restriccion === null) {
    return null;
  }
  return restriccion.includes("barcode") ? "products.barcode_taken" : "products.sku_taken";
}

/**
 * F10-PRESCODE — producto → la presentación activa cuyo código coincide
 * EXACTO con lo buscado: el código de barras (en cualquiera de sus escrituras
 * equivalentes) o el código interno. Una búsqueda parcial («bols») no elige
 * presentación: solo el código completo dice cuál es.
 */
async function presentacionesQueCoinciden(
  tx: Prisma.TransactionClient,
  productIds: string[],
  needle: string,
): Promise<Map<string, { id: string; name: string }>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const encontradas = await tx.productPresentation.findMany({
    where: {
      productId: { in: productIds },
      isActive: true,
      OR: [
        { barcode: { in: [...new Set([needle, ...barcodeSearchForms(needle)])] } },
        { code: normalizeCode(needle) },
      ],
    },
    select: { id: true, name: true, productId: true },
  });
  return new Map(encontradas.map((p) => [p.productId, { id: p.id, name: p.name }]));
}

/** Una presentación tal como la lleva cada resultado de `GET /products`. */
export interface ListedPresentation {
  id: string;
  name: string;
  /** Decimal en texto, como toda cantidad del API: un `number` se redondearía en el JSON. */
  factor: string;
  isActive: boolean;
  /** La presentación base del producto (`basePresentationIds`): solo ahí va el botón de unidad. */
  isBase: boolean;
}

/**
 * F10-BULK-07 — las presentaciones de los productos de UNA página, en una sola
 * consulta (no una por resultado), más la de `basePresentationIds` para su
 * `isBase`. Van todas, también las desactivadas, con su `isActive`: la
 * pantalla decide cuáles ofrece. El orden es el de la ficha (`findOne`):
 * `factor` solo no lo define cuando dos presentaciones empatan.
 */
async function presentacionesDeLaPagina(
  tx: Prisma.TransactionClient,
  productIds: string[],
): Promise<Map<string, ListedPresentation[]>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const filas = await tx.productPresentation.findMany({
    where: { productId: { in: productIds } },
    orderBy: [{ factor: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, factor: true, isActive: true, productId: true },
  });
  const bases = await basePresentationIds(tx, productIds);
  const porProducto = new Map<string, ListedPresentation[]>();
  for (const fila of filas) {
    const lista = porProducto.get(fila.productId) ?? [];
    lista.push({
      id: fila.id,
      name: fila.name,
      factor: fila.factor.toString(),
      isActive: fila.isActive,
      isBase: bases.has(fila.id),
    });
    porProducto.set(fila.productId, lista);
  }
  return porProducto;
}
