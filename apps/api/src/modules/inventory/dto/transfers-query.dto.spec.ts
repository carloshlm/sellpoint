import { INVALID_ID } from "../../../common/http/id-field";
import { listTransfersQuerySchema } from "./transfers-query.dto";

const UUID = "3f1c9a52-7d0b-4e8a-9c61-2b5d8e4f7a90";

/**
 * F10-MANFIX-20 — el listado de traspasos leía la consulta a mano. Un 400 por
 * un `page=abc` en un enlace viejo sería una pared en la puerta, así que su
 * DTO descarta la basura igual que antes; solo el id mal formado deja de
 * llegar crudo a la base.
 */
describe("listTransfersQuerySchema", () => {
  it("lo bien formado pasa con su tipo", () => {
    expect(
      listTransfersQuerySchema.parse({
        status: "in_transit",
        direction: "incoming",
        originWarehouseId: UUID,
        destinationWarehouseId: UUID,
        warehouseId: UUID,
        folio: "  SAL-000012 ",
        from: "2026-09-01",
        to: "2026-09-24",
        olderThanDays: "7",
        page: "2",
        pageSize: "20",
      }),
    ).toEqual({
      status: "in_transit",
      direction: "incoming",
      originWarehouseId: UUID,
      destinationWarehouseId: UUID,
      warehouseId: UUID,
      folio: "SAL-000012",
      from: "2026-09-01",
      to: "2026-09-24",
      olderThanDays: 7,
      page: 2,
      pageSize: 20,
    });
  });

  it("la basura que no es un id se descarta, no revienta", () => {
    expect(
      listTransfersQuerySchema.parse({
        status: "perdido",
        direction: "sideways",
        folio: "   ",
        from: "ayer",
        olderThanDays: "-1",
        page: "abc",
      }),
    ).toEqual({});
  });

  it("aquí el cero sí cuenta (`olderThanDays=0`), como el `entero()` de antes", () => {
    expect(listTransfersQuerySchema.parse({ olderThanDays: "0", page: "1.8" })).toEqual({
      olderThanDays: 0,
      page: 1,
    });
  });

  it("un folio repetido en la consulta se descarta en vez de romper el `trim`", () => {
    expect(listTransfersQuerySchema.parse({ folio: ["SAL-1", "SAL-2"] })).toEqual({});
  });

  it.each(["originWarehouseId", "destinationWarehouseId", "warehouseId"])(
    "`%s` vacío es «sin filtro»; mal formado, 400 `common.invalid_id`",
    (field) => {
      expect(listTransfersQuerySchema.parse({ [field]: "" })).toEqual({});
      expect(listTransfersQuerySchema.safeParse({ [field]: "abc" }).error?.issues[0]?.message).toBe(
        INVALID_ID,
      );
    },
  );
});
