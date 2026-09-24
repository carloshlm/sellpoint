import { BadRequestException, Controller, type ExecutionContext, Get } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { UuidParam, uuidParamFactory } from "./uuid-param.decorator";

function contextWithParams(params: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params }),
    }),
  } as unknown as ExecutionContext;
}

/** El cuerpo del 400, sin repetir el try/catch en cada caso. */
function rejection(params: Record<string, string>, name = "id"): unknown {
  try {
    uuidParamFactory(name, contextWithParams(params));
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error("el id pasó y no debía pasar");
}

describe("uuidParamFactory — @UuidParam() (F10-MANFIX-17)", () => {
  it("devuelve el id tal cual cuando es un uuid", () => {
    const id = "8c944151-d5e1-4a3f-a4da-8a9975a353cf";

    expect(uuidParamFactory("id", contextWithParams({ id }))).toBe(id);
  });

  it("lee el parámetro que se le nombra, no siempre `id`", () => {
    const params = { id: "8c944151-d5e1-4a3f-a4da-8a9975a353cf", lineId: "no-es-un-uuid" };

    expect(rejection(params, "lineId")).toEqual({ message: "common.invalid_id" });
  });

  /**
   * El uuid nulo es el «bien formado que no existe» que usan varias e2e
   * (`/medical-clinic/patients/00000000-…`): tiene que seguir llegando al 404
   * de su servicio. Las mayúsculas son el mismo uuid para Postgres.
   */
  it.each([
    ["el uuid nulo", "00000000-0000-0000-0000-000000000000"],
    ["un uuid en mayúsculas", "8C944151-D5E1-4A3F-A4DA-8A9975A353CF"],
  ])("acepta %s", (_caso, id) => {
    expect(uuidParamFactory("id", contextWithParams({ id }))).toBe(id);
  });

  /**
   * La misma regla que los ids del cuerpo (`z.uuid()`): un uuid sin guiones o
   * uno que no sigue el RFC no los genera la base (`gen_random_uuid()` da v4),
   * así que ningún enlace nuestro los trae.
   */
  it.each([
    ["un texto", "no-es-un-uuid"],
    ["un número", "42"],
    ["un uuid sin guiones", "8c944151d5e14a3fa4da8a9975a353cf"],
    ["un uuid que no sigue el RFC", "11111111-1111-1111-1111-111111111111"],
    ["un uuid con un carácter de más", "8c944151-d5e1-4a3f-a4da-8a9975a353cff"],
  ])("rechaza %s con un 400 `common.invalid_id`", (_caso, id) => {
    expect(rejection({ id })).toEqual({ message: "common.invalid_id" });
  });

  it("un nombre que la ruta no tiene también es 400: un `@UuidParam` mal escrito se nota al primer uso", () => {
    expect(rejection({ id: "8c944151-d5e1-4a3f-a4da-8a9975a353cf" }, "orderId")).toEqual({
      message: "common.invalid_id",
    });
  });
});

describe("@UuidParam en la documentación del API", () => {
  /**
   * Un decorador propio no es un `@Param` para Swagger, que solo documenta los
   * de Nest. Sin la declaración explícita, `/docs` perdería el `{id}` de más de
   * cien operaciones y el documento dejaría de ser OpenAPI válido.
   */
  it("el parámetro de ruta sigue documentado, y ahora dice que es uuid", async () => {
    @Controller("probe")
    class ProbeController {
      @Get(":id/lines/:lineId")
      line(@UuidParam("id") id: string, @UuidParam("lineId") lineId: string) {
        return { id, lineId };
      }
    }

    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    const app = moduleRef.createNestApplication();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    await app.close();

    const parameters = document.paths["/probe/{id}/lines/{lineId}"]?.get?.parameters;
    expect(parameters).toEqual(
      expect.arrayContaining([
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "lineId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ]),
    );
    expect(parameters).toHaveLength(2);
  });
});
