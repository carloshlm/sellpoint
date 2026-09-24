import { Prisma } from "../../generated/prisma/client";
import { isInvalidUuidInput } from "./invalid-uuid";

/**
 * F10-MANFIX-17 — la forma REAL del error, medida con una sonda contra
 * Postgres (2026-09-24): Prisma 7 con driver adapter no da el P2023 que se
 * esperaba, sino P2007 en una consulta del modelo y P2010 en una consulta
 * cruda. Lo que no cambia entre las dos es la causa del driver: el 22P02 de
 * Postgres con el tipo en el texto.
 */
function driverError(code: string, originalMessage: string, originalCode = "22P02") {
  return new Prisma.PrismaClientKnownRequestError(`Invalid input value: ${originalMessage}`, {
    code,
    clientVersion: "7.9.0",
    meta: {
      modelName: "Warehouse",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode,
          originalMessage,
          kind: "InvalidInputValue",
          message: originalMessage,
        },
      },
    },
  });
}

describe("isInvalidUuidInput", () => {
  it("reconoce un uuid mal formado en una consulta del modelo (P2007)", () => {
    const error = driverError("P2007", 'invalid input syntax for type uuid: "no-es-un-uuid"');

    expect(isInvalidUuidInput(error)).toBe(true);
  });

  it("y en una consulta cruda (P2010), que trae la misma causa", () => {
    const error = driverError("P2010", 'invalid input syntax for type uuid: "abc"');

    expect(isInvalidUuidInput(error)).toBe(true);
  });

  /**
   * Otro tipo que Postgres no pudo leer NO es un id: si el respaldo lo
   * tragara, contestaría «ese identificador no es válido» a una fecha, y un
   * error nuestro dejaría de llegar a Sentry.
   */
  it("un valor de otro tipo no es un uuid inválido", () => {
    const error = driverError("P2010", 'invalid input syntax for type integer: "abc"');

    expect(isInvalidUuidInput(error)).toBe(false);
  });

  it("mira el tipo, no el valor que escribió el cliente", () => {
    const error = driverError("P2010", 'invalid input syntax for type integer: "uuid"');

    expect(isInvalidUuidInput(error)).toBe(false);
  });

  it("otro error del driver con la palabra uuid tampoco", () => {
    const error = driverError(
      "P2002",
      'duplicate key value violates unique constraint "uuid_key"',
      "23505",
    );

    expect(isInvalidUuidInput(error)).toBe(false);
  });

  it("un error que no es de Prisma no es un uuid inválido", () => {
    expect(isInvalidUuidInput(new Error('invalid input syntax for type uuid: "abc"'))).toBe(false);
    expect(isInvalidUuidInput(undefined)).toBe(false);
  });
});
