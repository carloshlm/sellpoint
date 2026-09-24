import { INVALID_ID } from "../../../common/http/id-field";
import {
  inTransitExportQuerySchema,
  inTransitQuerySchema,
  kardexQuerySchema,
  productStockQuerySchema,
} from "./kardex-query.dto";

const UUID = "3f1c9a52-7d0b-4e8a-9c61-2b5d8e4f7a90";

/**
 * F10-MANFIX-20 — el kárdex y el tránsito leían la consulta a mano
 * (`Record<string, string>`). Su DTO tiene que hacer EXACTAMENTE lo mismo con
 * todo lo que no es un id: descartar la basura, porque un kárdex es lo
 * primero que alguien abre desde un enlace viejo. Lo único que cambia es el
 * id mal formado, que ya no llega crudo a la base.
 */
describe("kardexQuerySchema", () => {
  it("lo bien formado pasa con su tipo", () => {
    expect(
      kardexQuerySchema.parse({
        warehouseId: UUID,
        lotId: UUID,
        from: "2026-09-01",
        to: "2026-09-24",
        direction: "entry",
        reasonCode: "invoice",
        page: "2",
        pageSize: "50",
      }),
    ).toEqual({
      warehouseId: UUID,
      lotId: UUID,
      from: "2026-09-01",
      to: "2026-09-24",
      direction: "entry",
      reasonCode: "invoice",
      page: 2,
      pageSize: 50,
    });
  });

  it("la basura que no es un id se descarta, no revienta", () => {
    expect(
      kardexQuerySchema.parse({
        from: "ayer",
        to: "24/09/2026",
        direction: "sideways",
        reasonCode: "inventado",
        page: "abc",
        pageSize: "-5",
        otro: "lo que sea",
      }),
    ).toEqual({});
  });

  it("los números se truncan y el cero no cuenta, como el `entero()` de antes", () => {
    expect(kardexQuerySchema.parse({ page: "2.9", pageSize: "0" })).toEqual({ page: 2 });
  });

  it("un id vacío es «sin filtro»; uno mal formado, 400 `common.invalid_id`", () => {
    expect(kardexQuerySchema.parse({ warehouseId: "", lotId: "" })).toEqual({});
    expect(kardexQuerySchema.safeParse({ lotId: "abc" }).error?.issues[0]?.message).toBe(
      INVALID_ID,
    );
  });
});

describe("productStockQuerySchema, inTransitQuerySchema", () => {
  it("sus ids siguen la misma regla", () => {
    expect(productStockQuerySchema.parse({ warehouseId: "" })).toEqual({});
    expect(inTransitQuerySchema.parse({ productId: UUID, originWarehouseId: "" })).toEqual({
      productId: UUID,
    });
    expect(
      inTransitQuerySchema.safeParse({ originWarehouseId: "abc" }).error?.issues[0]?.message,
    ).toBe(INVALID_ID);
  });

  it("el export baja CSV solo si se pide; cualquier otra cosa es Excel", () => {
    expect(inTransitExportQuerySchema.parse({ format: "csv" }).format).toBe("csv");
    expect(inTransitExportQuerySchema.parse({ format: "pdf" }).format).toBe("xlsx");
    expect(inTransitExportQuerySchema.parse({}).format).toBe("xlsx");
  });
});
