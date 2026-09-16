import { Injectable, Logger } from "@nestjs/common";
import { normalizeSearchText } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/** Un código que el catálogo compartido no tenía, listo para aportarse. */
export interface BarcodeContribution {
  gtin14: string;
  /** El prefijo GS1: es lo que decide si el código puede entrar. */
  prefix: string;
  name: string;
}

/**
 * F10-QUICKCAT-05 — lo que un negocio le regala al catálogo de todos.
 *
 * ── Solo se inserta. Un registro existente NUNCA se edita ────────────────
 *
 * Ni su nombre, ni su marca, ni su contador (regla de Carlos, 2026-09-16). El
 * `ON CONFLICT DO NOTHING` no es una optimización: es la regla escrita en SQL.
 * `confirmations` nace en 1 y no se vuelve a tocar — contar negocios DISTINTOS
 * exige un libro mayor aparte y está pospuesto con nombre.
 *
 * ── El filtro de lo que nunca entra es el JOIN, no un `if` ───────────────
 *
 * `gs1_prefix_ranges` con `is_importable` decide, dentro de la misma consulta
 * que inserta. Un `if` en TypeScript sería igual de correcto y se podría
 * olvidar la próxima vez que alguien llame a este servicio desde otro lado;
 * el JOIN no se puede saltar. Quedan fuera los rangos de circulación
 * restringida (la etiqueta de la báscula, la marca blanca), los cupones, los
 * ISBN/ISSN y los recibos de reembolso: el `2000000000017` de una carnicería
 * no es el de la tienda de al lado, y meterlo al catálogo compartido sería
 * envenenarlo.
 *
 * ── Nunca recibe una transacción, solo datos planos ──────────────────────
 *
 * `global_barcode_catalog` no tiene RLS. Si este servicio aceptara el `tx` del
 * negocio, un descuido bastaría para escribir una tabla con RLS desde el lado
 * que no lo tiene. Recibe el id del negocio como dato y abre lo suyo.
 */
@Injectable()
export class BarcodeContributionService {
  private readonly logger = new Logger(BarcodeContributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve cuántos códigos entraron. **No lanza nunca**: el negocio ya se
   * quedó con sus productos y perder una fila de un catálogo que se llena solo
   * no puede convertirse en un error en el mostrador.
   */
  async contribute(tenantId: string, codigos: BarcodeContribution[]): Promise<number> {
    if (codigos.length === 0) {
      return 0;
    }

    try {
      const filas = codigos.map(
        (c) =>
          Prisma.sql`(${c.gtin14}::char(14), ${c.prefix}::char(3), ${c.name}::varchar(300), ${normalizeSearchText(c.name)}::varchar(300))`,
      );

      // Las marcas de tiempo van explícitas: `updatedAt` lo pone Prisma en cada
      // escritura suya y la columna no tiene default, así que un INSERT en SQL
      // crudo sin ella rebota contra el NOT NULL.
      return await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "global_barcode_catalog" (
          "gtin14", "product_name", "search", "country_code",
          "source", "confirmations", "contributed_by_tenant_id", "contributed_at",
          "created_at", "updated_at"
        )
        SELECT nuevo.gtin14, nuevo.nombre, nuevo.busqueda, rango."country_code",
               'tenant_contributed', 1, ${tenantId}::uuid, now(), now(), now()
        FROM (VALUES ${Prisma.join(filas)}) AS nuevo(gtin14, prefijo, nombre, busqueda)
        JOIN "gs1_prefix_ranges" rango
          ON rango."prefix_from" <= nuevo.prefijo
         AND nuevo.prefijo <= rango."prefix_to"
         AND rango."is_importable"
        ON CONFLICT ("gtin14") DO NOTHING`);
    } catch (error) {
      // El motivo va en el MENSAJE, no solo en la traza: este error se lee en
      // un log de producción, donde nadie va a reconstruir la consulta.
      this.logger.error(
        `El aporte de ${codigos.length} códigos del negocio ${tenantId} no se pudo guardar: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      return 0;
    }
  }
}
