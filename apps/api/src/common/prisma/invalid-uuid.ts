import { Prisma } from "../../generated/prisma/client";

/**
 * ¿El error es Postgres diciendo que un texto no es un uuid?
 *
 * ── Por qué existe esta función (F10-MANFIX-17, 2026-09-24) ─────────────
 *
 * Es el respaldo de `@UuidParam` y de los DTO: los ids de ruta se revisan
 * antes de llegar a la base, y desde la F10-MANFIX-20 también los de la
 * CONSULTA (`idField()` en cada DTO; antes, `?warehouseId=` de los lotes, del
 * kárdex y de los traspasos llegaban crudos). El filtro de excepciones usa
 * esto para contestar la entrada que se escape como lo que es —un 400 de
 * quien llama— en vez de como un 500 nuestro. Es una red: en operación normal
 * no se pisa (`query-ids.e2e-spec.ts`), y su forma real la fija
 * `invalid-uuid.integration.spec.ts`.
 *
 * Se mira la causa del driver y no el código de Prisma porque el código
 * CAMBIA según la consulta. Medido con una sonda contra Postgres: P2007 en
 * una consulta del modelo, P2010 en una cruda (`$queryRaw`). La causa es la
 * misma en las dos: el 22P02 de Postgres, con el tipo en el texto. Y NO es
 * el P2023 que se esperaba: con driver adapter, ese código es de los datos
 * que se LEEN mal, que sí son un error nuestro.
 *
 * Solo el tipo `uuid`: otro 22P02 (una fecha, un entero en una consulta
 * cruda) no es un id, y contestarle «ese identificador no es válido» sería
 * mentirle; esos siguen siendo un 500 que llega a Sentry.
 */
export function isInvalidUuidInput(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  const cause = (
    error.meta as
      | { driverAdapterError?: { cause?: { originalCode?: unknown; originalMessage?: unknown } } }
      | undefined
  )?.driverAdapterError?.cause;
  if (cause?.originalCode !== "22P02" || typeof cause.originalMessage !== "string") {
    return false;
  }

  // `invalid input syntax for type uuid: "abc"`. Se mira solo lo de antes de
  // los dos puntos: lo entrecomillado lo escribió el cliente y podría decir
  // «uuid» siendo otro tipo.
  const [kind = ""] = cause.originalMessage.split(":", 1);
  return /\buuid$/.test(kind.trim());
}
