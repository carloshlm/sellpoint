import { Prisma } from "../../generated/prisma/client";
import { restriccionViolada } from "./unique-violation";

/**
 * ⚠ EL BUG QUE ESTE ARCHIVO EXISTE PARA MATAR (2026-08-24).
 *
 * Dos services traducían un P2002 a su mensaje leyendo `error.meta.target`.
 * Con Prisma 7 y driver adapter **ese campo no existe**: el nombre de la
 * restricción viaja enterrado en
 * `meta.driverAdapterError.cause.originalMessage`. Medido con una sonda
 * contra Postgres real.
 *
 * La consecuencia era silenciosa y por eso peligrosa: `products.service`
 * acusaba al SKU cuando el repetido era el código de barras, y
 * `presentations.service` decía «nombre repetido» ante un código de barras
 * duplicado. El usuario iba a buscar el problema donde no estaba, y ningún
 * test se ponía rojo porque los dos caminos devolvían 409 igual.
 */
describe("restriccionViolada", () => {
  const conAdapter = (constraint: string) =>
    new Prisma.PrismaClientKnownRequestError("", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: {
        modelName: "ProductPresentation",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage: `duplicate key value violates unique constraint "${constraint}"`,
            kind: "UniqueConstraintViolation",
          },
        },
      },
    });

  it("saca el nombre de la restricción del error del driver adapter", () => {
    expect(restriccionViolada(conAdapter("product_presentations_tenant_id_barcode_key"))).toBe(
      "product_presentations_tenant_id_barcode_key",
    );
  });

  it("sigue leyendo `meta.target` cuando SÍ viene", () => {
    // Prisma lo poblaba en versiones anteriores y podría volver a hacerlo: se
    // aceptan las dos formas en vez de apostar a una.
    const conTarget = new Prisma.PrismaClientKnownRequestError("", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: { target: ["tenant_id", "barcode"] },
    });

    expect(restriccionViolada(conTarget)).toContain("barcode");
  });

  it("un error que NO es violación de unicidad no tiene restricción", () => {
    const otro = new Prisma.PrismaClientKnownRequestError("", {
      code: "P2025",
      clientVersion: "7.0.0",
    });

    expect(restriccionViolada(otro)).toBeNull();
    expect(restriccionViolada(new Error("cualquier cosa"))).toBeNull();
  });

  it("un P2002 sin pistas devuelve cadena vacía, no revienta", () => {
    // Peor que no saber qué se repitió es tirar un 500 encima del 409.
    const pelado = new Prisma.PrismaClientKnownRequestError("", {
      code: "P2002",
      clientVersion: "7.0.0",
    });

    expect(restriccionViolada(pelado)).toBe("");
  });
});
