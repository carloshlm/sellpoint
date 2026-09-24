import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe";
import { INVALID_ID, idField, optionalIdFilter } from "./id-field";

const UUID = "3f1c9a52-7d0b-4e8a-9c61-2b5d8e4f7a90";

/** El cuerpo del 400 que arma el pipe de Zod, o `null` si el valor pasó. */
function rejection(schema: z.ZodType, value: unknown): unknown {
  try {
    new ZodValidationPipe(schema, "reports.invalid_query").transform(value);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
}

describe("idField — el id de un DTO (F10-MANFIX-20)", () => {
  it("usa la clave de `@UuidParam`: un id malo dice lo mismo venga por donde venga", () => {
    expect(INVALID_ID).toBe("common.invalid_id");
  });

  it("acepta un uuid", () => {
    expect(idField().parse(UUID)).toBe(UUID);
  });

  it.each([
    ["un texto", "no-es-un-uuid"],
    ["el vacío", ""],
    // Postgres lo leería, pero no es de los que genera la base (`gen_random_uuid()`):
    // la misma regla que ya aplican la ruta y el cuerpo.
    ["un uuid sin versión ni variante", "11111111-2222-3333-4444-555555555555"],
    ["un id repetido en la consulta", [UUID, UUID]],
  ])("rechaza %s con `common.invalid_id`", (_caso, value) => {
    const result = idField().safeParse(value);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INVALID_ID);
  });

  /**
   * Lo que ve quien llama: el 400 lleva la clave del id como mensaje general
   * —no el `invalid_query` del módulo— y además nombra el campo, que es lo
   * que el `@UuidParam` de la ruta no necesita decir.
   */
  it("en un DTO de consulta, el 400 dice `common.invalid_id` y nombra el campo", () => {
    const schema = z.object({ warehouseId: idField().optional(), page: z.coerce.number() });

    expect(rejection(schema, { warehouseId: "abc", page: "1" })).toEqual({
      message: INVALID_ID,
      errors: [{ key: "warehouseId", message: INVALID_ID }],
    });
    expect(rejection(schema, { warehouseId: UUID, page: "1" })).toBeNull();
  });
});

describe("optionalIdFilter — el id de un filtro que descarta la basura", () => {
  const schema = z.object({ warehouseId: optionalIdFilter() });

  it("vacío es «sin filtro», igual que ausente", () => {
    expect(schema.parse({ warehouseId: "" })).toEqual({});
    expect(schema.parse({})).toEqual({});
  });

  it("un uuid pasa tal cual", () => {
    expect(schema.parse({ warehouseId: UUID })).toEqual({ warehouseId: UUID });
  });

  it.each([
    ["un texto", "no-es-un-uuid"],
    ["un id repetido", [UUID, "otro"]],
  ])("%s NO se descarta: es 400 `common.invalid_id`", (_caso, warehouseId) => {
    expect(rejection(schema, { warehouseId })).toEqual({
      message: INVALID_ID,
      errors: [{ key: "warehouseId", message: INVALID_ID }],
    });
  });
});
