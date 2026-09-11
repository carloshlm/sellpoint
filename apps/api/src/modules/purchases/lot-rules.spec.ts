import { aplicarReglasDeLote } from "./lot-rules";

/**
 * Las reglas de lote, sin base: un `tx` de mentira con los dos `findMany` que
 * el helper consulta. Los mismos casos que el e2e de compras fija de punta a
 * punta, acá aislados para que la recepción (F9-PO-07) los herede probados.
 */
function tx(
  productos: { id: string; tracksLots: boolean }[],
  lotes: { productId: string; lotCode: string; expiresAt: Date | null }[],
) {
  return {
    product: { findMany: jest.fn().mockResolvedValue(productos) },
    productLot: { findMany: jest.fn().mockResolvedValue(lotes) },
  } as never;
}

describe("aplicarReglasDeLote", () => {
  it("sin partidas no consulta nada", async () => {
    const t = tx([], []);
    await expect(aplicarReglasDeLote(t, "t1", [])).resolves.toEqual([]);
    expect((t as { product: { findMany: jest.Mock } }).product.findMany).not.toHaveBeenCalled();
  });

  it("un lote en un producto que no se controla por lote rebota nombrando la línea", async () => {
    const t = tx([{ id: "p1", tracksLots: false }], []);
    await expect(
      aplicarReglasDeLote(t, "t1", [
        { productId: "p1", lotCode: null, expiresAt: null },
        { productId: "p1", lotCode: "ST1", expiresAt: null },
      ]),
    ).rejects.toMatchObject({
      response: { message: "purchases.lot_not_tracked", args: { field: "lines.2.lotCode" } },
    });
    // La sola caducidad también es «lote».
    await expect(
      aplicarReglasDeLote(t, "t1", [{ productId: "p1", lotCode: null, expiresAt: "2027-01-31" }]),
    ).rejects.toMatchObject({ response: { message: "purchases.lot_not_tracked" } });
  });

  it("un lote conocido presta su caducidad a la línea sin fecha y rebota otra distinta", async () => {
    const t = tx(
      [{ id: "p1", tracksLots: true }],
      [{ productId: "p1", lotCode: "HIST-01", expiresAt: new Date("2028-05-31") }],
    );
    const [heredada] = await aplicarReglasDeLote(t, "t1", [
      { productId: "p1", lotCode: "HIST-01", expiresAt: null },
    ]);
    expect(heredada?.expiresAt?.toISOString().slice(0, 10)).toBe("2028-05-31");
    await expect(
      aplicarReglasDeLote(t, "t1", [
        { productId: "p1", lotCode: "HIST-01", expiresAt: "2029-01-01" },
      ]),
    ).rejects.toMatchObject({
      response: { message: "purchases.lot_expiry_mismatch", args: { field: "lines.1.expiresAt" } },
    });
    // La misma fecha pasa; un lote nuevo se queda con la suya.
    const [misma, nuevo] = await aplicarReglasDeLote(t, "t1", [
      { productId: "p1", lotCode: "HIST-01", expiresAt: "2028-05-31" },
      { productId: "p1", lotCode: "NUEVO", expiresAt: "2030-01-01" },
    ]);
    expect(misma?.expiresAt?.toISOString().slice(0, 10)).toBe("2028-05-31");
    expect(nuevo?.expiresAt?.toISOString().slice(0, 10)).toBe("2030-01-01");
  });

  it("el nombre del campo lo pone quien llama: la recepción no dice `lines`", async () => {
    const t = tx([{ id: "p1", tracksLots: false }], []);
    await expect(
      aplicarReglasDeLote(
        t,
        "t1",
        [{ productId: "p1", lotCode: "X", expiresAt: null }],
        (i) => `receipt.${i}`,
      ),
    ).rejects.toMatchObject({ response: { args: { field: "receipt.0.lotCode" } } });
  });
});
