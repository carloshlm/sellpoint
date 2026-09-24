import { BadRequestException, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { ApiParam } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";

/**
 * La misma regla que ya validaba los ids del cuerpo (`productId`, `quoteId`…):
 * un id que el cuerpo acepta, la ruta también. La base los genera con
 * `gen_random_uuid()`, así que todo enlace nuestro trae uno que pasa.
 */
const UUID = z.uuid();

/**
 * Separada del decorador para probarla sin levantar Nest (el mismo patrón que
 * `current-user-scope.decorator.ts`).
 */
export function uuidParamFactory(name: string, ctx: ExecutionContext): string {
  const value = ctx.switchToHttp().getRequest<Request>().params[name];
  const parsed = UUID.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({ message: "common.invalid_id" });
  }
  return parsed.data;
}

const uuidFromRoute = createParamDecorator(uuidParamFactory);

/**
 * F10-MANFIX-17 — el parámetro de ruta que es un id se revisa ANTES de llegar
 * a Prisma.
 *
 *   @Get(":id/lines/:lineId")
 *   line(@UuidParam("id") id: string, @UuidParam("lineId") lineId: string) {}
 *
 * Crudo, `GET /products/abc` llegaba a la base: la columna es `uuid`, Postgres
 * no podía leer el texto (22P02, que Prisma 7 entrega como P2007) y el filtro
 * de excepciones lo contestaba como un 500 nuestro, que además iba a Sentry.
 * Es un error de quien llama: 400 con `common.invalid_id`, sin tocar la base.
 * Un uuid bien formado que no existe sigue siendo el 404 de cada servicio.
 *
 * ── Por qué un decorador y no un pipe sobre `@Param` ────────────────────
 *
 * El punto de venta lo resolvió primero con un pipe (`@Param("id", ID)`), y
 * el pipe tiene un hueco: Nest corre los pipes de todos los parámetros A LA
 * VEZ y contesta con el primer error que termina. Con un id malo y un cuerpo
 * incompleto ganaba el cuerpo: `POST /pos/quotes/abc/cancel` sin motivo
 * contestaba «Revisa los datos del punto de venta» por una cotización que no
 * puede existir (medido en la e2e el 2026-09-24).
 *
 * Un decorador propio revisa el id cuando Nest EXTRAE el valor, y esa
 * extracción es síncrona y ocurre antes de que corra cualquier pipe: el id
 * malo siempre gana, venga como venga el cuerpo. `route-ids.e2e-spec.ts` lo
 * fija mandando PATCH y POST sin cuerpo a cada ruta con id.
 *
 * ── Swagger ─────────────────────────────────────────────────────────────
 *
 * Swagger solo documenta los `@Param` de Nest; un decorador propio le es
 * invisible y `/docs` habría perdido el `{id}` de más de cien operaciones. Por
 * eso este lo declara él mismo con `ApiParam`, y de paso dice que es uuid.
 */
export function UuidParam(name: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    uuidFromRoute(name)(target, propertyKey, parameterIndex);

    // `propertyKey` solo falta en un parámetro del constructor, que no es ruta.
    const descriptor =
      propertyKey === undefined ? undefined : Object.getOwnPropertyDescriptor(target, propertyKey);
    if (propertyKey !== undefined && descriptor) {
      ApiParam({ name, type: String, format: "uuid" })(target, propertyKey, descriptor);
    }
  };
}
