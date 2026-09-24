import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { isInvalidUuidInput } from "./invalid-uuid";

/**
 * Integration (Postgres real) — F10-MANFIX-20: el respaldo sigue
 * reconociendo el error DE VERDAD.
 *
 * Desde la 20 ninguna entrada del API deja llegar un id mal formado a la base
 * (`query-ids.e2e-spec.ts` lo vigila), así que ya ninguna e2e pasa por el
 * respaldo del filtro de excepciones. Sus pruebas unitarias arman el error a
 * mano con la forma que midió la 17, y esa forma es de Prisma 7 con driver
 * adapter: si una actualización la cambiara, el respaldo dejaría de
 * reconocerlo sin que nada fallara, y el día que se escapara una entrada nueva
 * volvería el 500 con aviso a Sentry. Esta prueba provoca el error en
 * Postgres, sin fabricarlo.
 */
describe("isInvalidUuidInput contra Postgres (F10-MANFIX-20)", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  /** El error con el que falló la consulta, o `null` si no falló. */
  const failureOf = (query: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    prisma.withTenantContext(randomUUID(), query).then(
      () => null,
      (error: unknown) => error,
    );

  it("reconoce el uuid mal formado de una consulta del modelo", async () => {
    const error = await failureOf((tx) =>
      tx.warehouse.findFirst({ where: { id: "no-es-un-uuid" } }),
    );

    expect(isInvalidUuidInput(error)).toBe(true);
  });

  it("y el de una consulta cruda, que Prisma entrega con otro código", async () => {
    const error = await failureOf((tx) => tx.$queryRaw`SELECT ${"no-es-un-uuid"}::uuid`);

    expect(isInvalidUuidInput(error)).toBe(true);
  });

  it("pero no otro valor que Postgres no pudo leer: ese sigue siendo un error nuestro", async () => {
    const error = await failureOf((tx) => tx.$queryRaw`SELECT ${"abc"}::integer`);

    expect(error).not.toBeNull();
    expect(isInvalidUuidInput(error)).toBe(false);
  });
});
