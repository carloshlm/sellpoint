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
 * ── Solo se ESCRIBE donde no había nada ─────────────────────────────────
 *
 * La regla de Carlos era «un registro existente no se edita». Desde F10-LANG
 * (2026-09-16) se mudó de nivel: no se edita ninguna CASILLA que ya tenga algo.
 * Ni el nombre, ni la marca, ni el contador — pero la casilla del idioma que
 * está VACÍA sí se llena, y esa es la diferencia que convierte el tecleo de un
 * negocio en catálogo para el siguiente.
 *
 * Por qué importa, medido: de los productos canadienses con nombre en francés,
 * solo un tercio tiene el inglés en Open Food Facts. Los otros dos tercios los
 * teclea el negocio que los vende. Sin esto, ese trabajo se quedaba en su
 * catálogo privado y el siguiente negocio volvía a ver el francés.
 *
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
   * Devuelve cuántas filas entraron o se enriquecieron. **No lanza nunca**: el
   * negocio ya se quedó con sus productos y perder una fila de un catálogo que
   * se llena solo no puede convertirse en un error en el mostrador.
   *
   * `locale` es el idioma del negocio que aporta, y decide EN QUÉ CASILLA cae
   * el nombre: un negocio mexicano que teclea «Aceite de oliva extra virgen»
   * le deja ese nombre al siguiente negocio mexicano, no a uno canadiense.
   */
  async contribute(
    tenantId: string,
    locale: string,
    codigos: BarcodeContribution[],
  ): Promise<number> {
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
      // El nombre cae en la casilla del idioma del negocio, y en la otra va
      // NULL: no sabemos cómo se llama ese producto en el idioma que no se
      // habló. Inventarlo copiándolo sería llenar el catálogo de nombres que
      // dicen estar en un idioma y están en otro.
      const enEspanol = locale === "es";
      return await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "global_barcode_catalog" (
          "gtin14", "product_name", "name_es", "name_en", "name_lang", "search",
          "country_code", "source", "confirmations",
          "contributed_by_tenant_id", "contributed_at", "created_at", "updated_at"
        )
        SELECT nuevo.gtin14, nuevo.nombre,
               CASE WHEN ${enEspanol} THEN nuevo.nombre END,
               CASE WHEN ${enEspanol} THEN NULL ELSE nuevo.nombre END,
               ${locale}::char(2),
               nuevo.busqueda, rango."country_code",
               'tenant_contributed', 1, ${tenantId}::uuid, now(), now(), now()
        FROM (VALUES ${Prisma.join(filas)}) AS nuevo(gtin14, prefijo, nombre, busqueda)
        JOIN "gs1_prefix_ranges" rango
          ON rango."prefix_from" <= nuevo.prefijo
         AND nuevo.prefijo <= rango."prefix_to"
         AND rango."is_importable"
        -- ── La casilla vacía se llena; la escrita no se toca ─────────────
        --
        -- Este es el camino que más vale de todo F10-LANG. Un negocio
        -- canadiense corrige «Huile d'olive vierge extra» y teclea «Extra
        -- Virgin Olive Oil»: ese inglés entra en \`name_en\`, que estaba vacía,
        -- y el siguiente negocio ya lo encuentra. Lo que NO puede pasar es que
        -- pise un nombre que otro escribió antes — de ahí los COALESCE.
        --
        -- El WHERE evita escribir cuando no hay nada que llenar: sin él,
        -- reenviar el mismo borrador movería \`updated_at\` de filas que no
        -- cambiaron y el reporte diría que aportó algo.
        ON CONFLICT ("gtin14") DO UPDATE SET
          "name_es" = COALESCE("global_barcode_catalog"."name_es", EXCLUDED."name_es"),
          "name_en" = COALESCE("global_barcode_catalog"."name_en", EXCLUDED."name_en"),
          "updated_at" = now()
        WHERE ("global_barcode_catalog"."name_es" IS NULL AND EXCLUDED."name_es" IS NOT NULL)
           OR ("global_barcode_catalog"."name_en" IS NULL AND EXCLUDED."name_en" IS NOT NULL)`);
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
