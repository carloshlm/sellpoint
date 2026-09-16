import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { classifyGtin, cleanGtin, normalizeCode } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import {
  type BarcodeContribution,
  BarcodeContributionService,
} from "./barcode-contribution.service";
import type { QuickAddDto } from "./dto/quick-add.dto";
import { basePresentationName, claveDeConflicto, derivesFractionalInput } from "./products.service";

/** El molde de `ImportRowError`: la línea, su código para buscarla, y la clave i18n. */
export interface QuickAddLineError {
  line: number;
  /** El código de barras de la línea: se encuentra con Ctrl+F, «línea 37» no. */
  itemCode: string;
  field?: "code" | "name" | "price";
  /** Clave i18n cruda: el filtro de excepciones la traduce con sus `args`. */
  message: string;
  args?: Record<string, unknown>;
}

export interface QuickAddReport {
  created: number;
  /** Productos que el negocio YA tenía: se les actualizó SOLO el precio. */
  updated: number;
  /** Códigos que nadie conocía y que este negocio le regaló al catálogo global. */
  contributed: number;
}

/** La unidad base de todo lo que se da de alta acá: piezas. */
const UNIDAD_BASE = "unit";

/**
 * F10-QUICKCAT-04 — dar de alta el catálogo inicial de un tirón.
 *
 * ── Todo o nada ─────────────────────────────────────────────────────────
 *
 * Una línea mala no guarda ninguna. Devolver la mitad guardada obligaría a la
 * pantalla —y a la persona— a adivinar qué renglones quitar del borrador, y
 * el borrador vive en el navegador: reintentar cuesta un clic, así que la
 * simplicidad se paga sola.
 *
 * ── Lo que se valida ANTES de escribir ──────────────────────────────────
 *
 * Los errores previsibles —el código repetido dentro del envío, el sku que ya
 * ocupa otro producto— se juntan TODOS en una pasada y vuelven juntos. Que
 * alguien corrija una línea, reintente y descubra la siguiente, y así diez
 * veces, es exactamente la tarde de formularios que esta pantalla vino a
 * eliminar.
 *
 * ── Lo que NO se toca de un producto que ya existe ──────────────────────
 *
 * Solo el PRECIO. Ni el nombre, ni el sku, ni la unidad: el negocio ya decidió
 * cómo se llama su producto, y esta pantalla no está para renombrarle el
 * catálogo a nadie.
 */
@Injectable()
export class QuickAddService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly contribution: BarcodeContributionService,
  ) {}

  async run(user: AuthUser, dto: QuickAddDto, meta: RequestMeta): Promise<QuickAddReport> {
    const lineas = dto.lines.map((linea, indice) => {
      const gtin = classifyGtin(linea.code);
      return {
        numero: indice + 1,
        gtin14: gtin?.gtin14 ?? null,
        // `null` cuando el código es de circulación restringida: vale para
        // este negocio y no se aporta jamás.
        prefix: gtin?.prefix ?? null,
        // El código se guarda como se escaneó, salvo la limpieza del GTIN: el
        // mostrador lo compara literal y esta función no migra datos de nadie.
        code: gtin === null ? linea.code.trim() : cleanGtin(linea.code),
        // La clave para detectar repetidos: `7501055300013` y su forma con
        // cero adelante son el MISMO producto escrito de dos maneras.
        clave: gtin?.gtin14 ?? linea.code.trim(),
        formas: gtin?.variants ?? [linea.code.trim()],
        name: linea.name,
        price: linea.price,
      };
    });

    const errores = this.repetidosDentroDelEnvio(lineas);
    if (errores.length > 0) {
      throw this.rechazo(errores);
    }

    const { reporte, aportables } = await this.prisma.withTenantContext(
      user.tenantId,
      async (tx) => {
        const existentes = await this.presentacionesPorCodigo(tx, lineas);
        const conflictos = await this.skusOcupados(tx, lineas, existentes);
        if (conflictos.length > 0) {
          throw this.rechazo(conflictos);
        }

        let created = 0;
        let updated = 0;
        const aportables: BarcodeContribution[] = [];

        for (const linea of lineas) {
          const yaEsta = linea.formas
            .map((forma) => existentes.get(forma))
            .find((x) => x !== undefined);
          try {
            if (yaEsta !== undefined) {
              await tx.productPresentation.update({
                where: { id: yaEsta.presentationId },
                data: { price: linea.price },
              });
              updated += 1;
            } else {
              await this.altaDeProducto(tx, user, linea);
              created += 1;
              if (linea.gtin14 !== null && linea.prefix !== null) {
                aportables.push({ gtin14: linea.gtin14, prefix: linea.prefix, name: linea.name });
              }
            }
          } catch (error) {
            // Una violación de unicidad que se escapó de las comprobaciones
            // previas: dos sesiones cargando a la vez. Cae en SU línea, no como
            // un 409 sin número que obliga a buscar cuál fue.
            const clave = claveDeConflicto(error);
            if (clave === null) {
              throw error;
            }
            throw this.rechazo([
              { line: linea.numero, itemCode: linea.code, field: "code", message: clave },
            ]);
          }
        }

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "products.quick_add",
          resourceType: "product",
          after: { created, updated, lines: lineas.length },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return { reporte: { created, updated }, aportables };
      },
    );

    // ── Después del COMMIT, y en su propia transacción ──────────────────
    //
    // Primero lo que el negocio pidió; el regalo al catálogo de todos va
    // después y no puede tumbarlo. Si el aporte falla, el negocio se queda con
    // sus 60 productos y la plataforma pierde una fila de un catálogo que se
    // llena solo. Al revés sería indefendible en el mostrador.
    const contributed = await this.contribution.contribute(user.tenantId, user.locale, aportables);
    return { ...reporte, contributed };
  }

  /** El alta mínima: el producto, su presentación base y su precio. */
  private async altaDeProducto(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    linea: { code: string; name: string; price: number },
  ): Promise<void> {
    const product = await tx.product.create({
      data: {
        tenantId: user.tenantId,
        // El sku es el código, la misma regla del formulario de alta. Sin uno
        // propio, el código de barras es el identificador que el negocio tiene.
        sku: normalizeCode(linea.code),
        name: linea.name,
        baseUnit: UNIDAD_BASE,
        attributes: {},
      },
    });

    await tx.productPresentation.create({
      data: {
        tenantId: user.tenantId,
        productId: product.id,
        name: basePresentationName(UNIDAD_BASE, user.locale),
        factor: 1,
        isPurchasable: true,
        isSellable: true,
        isDefaultSale: true,
        allowFractionalInput: derivesFractionalInput(UNIDAD_BASE),
        price: linea.price,
        // Sin costo a propósito: el costo se descubre al recibir mercancía.
        cost: null,
        barcode: linea.code,
      },
    });
  }

  /** Qué presentación del negocio lleva cada uno de los códigos del envío. */
  private async presentacionesPorCodigo(
    tx: Prisma.TransactionClient,
    lineas: { formas: string[] }[],
  ): Promise<Map<string, { presentationId: string; productId: string }>> {
    const formas = [...new Set(lineas.flatMap((linea) => linea.formas))];
    const filas = await tx.productPresentation.findMany({
      where: { barcode: { in: formas }, isActive: true, product: { isActive: true } },
      select: { id: true, barcode: true, productId: true },
    });
    return new Map(
      filas
        .filter((fila): fila is typeof fila & { barcode: string } => fila.barcode !== null)
        .map((fila) => [fila.barcode, { presentationId: fila.id, productId: fila.productId }]),
    );
  }

  /**
   * El sku que ya ocupa OTRO producto.
   *
   * Pasa cuando alguien dio de alta el producto tecleando el código como sku y
   * sin código de barras: el alta chocaría con un 409 sin número de línea.
   * Acá se convierte en un error de SU renglón, y en la misma pasada que los
   * demás.
   */
  private async skusOcupados(
    tx: Prisma.TransactionClient,
    lineas: { numero: number; code: string; formas: string[] }[],
    existentes: Map<string, { presentationId: string; productId: string }>,
  ): Promise<QuickAddLineError[]> {
    const nuevas = lineas.filter((linea) => !linea.formas.some((forma) => existentes.has(forma)));
    if (nuevas.length === 0) {
      return [];
    }

    const skus = nuevas.map((linea) => normalizeCode(linea.code));
    const tomados = new Set(
      (await tx.product.findMany({ where: { sku: { in: skus } }, select: { sku: true } })).map(
        (fila) => fila.sku,
      ),
    );

    return nuevas
      .filter((linea) => tomados.has(normalizeCode(linea.code)))
      .map((linea) => ({
        line: linea.numero,
        itemCode: linea.code,
        field: "code" as const,
        message: "products.sku_taken",
      }));
  }

  /** El mismo código dos veces en el envío: la segunda nombra a la primera. */
  private repetidosDentroDelEnvio(
    lineas: { numero: number; code: string; clave: string }[],
  ): QuickAddLineError[] {
    const vistas = new Map<string, number>();
    const errores: QuickAddLineError[] = [];
    for (const linea of lineas) {
      const primera = vistas.get(linea.clave);
      if (primera === undefined) {
        vistas.set(linea.clave, linea.numero);
      } else {
        errores.push({
          line: linea.numero,
          itemCode: linea.code,
          field: "code",
          message: "products.quick_duplicate_line",
          args: { line: primera },
        });
      }
    }
    return errores;
  }

  private rechazo(errors: QuickAddLineError[]): UnprocessableEntityException {
    return new UnprocessableEntityException({ message: "products.quick_has_errors", errors });
  }
}
