import { QuickAddService } from "./quick-add.service";

/**
 * F10-QUICKCAT-04 — qué se escribe, qué NO se toca y qué vuelve por línea.
 * El camino contra la base lo prueba el e2e.
 */
describe("QuickAddService", () => {
  const findManyPresentaciones = jest.fn();
  const findManyProductos = jest.fn();
  const updatePresentacion = jest.fn();
  const createProducto = jest.fn();
  const createPresentacion = jest.fn();
  const auditar = jest.fn();

  const tx = {
    productPresentation: {
      findMany: findManyPresentaciones,
      update: updatePresentacion,
      create: createPresentacion,
    },
    product: { findMany: findManyProductos, create: createProducto },
  };

  const service = new QuickAddService(
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    { withTenantContext: (_t: string, cb: (tx: unknown) => unknown) => cb(tx) } as any,
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    { record: auditar } as any,
  );

  const usuario = { tenantId: "t-1", userId: "u-1", locale: "es" } as never;
  const meta = { ip: "127.0.0.1", userAgent: "jest" };
  const correr = (lines: { code: string; name: string; price: number }[]) =>
    service.run(usuario, { lines }, meta);

  beforeEach(() => {
    findManyPresentaciones.mockReset().mockResolvedValue([]);
    findManyProductos.mockReset().mockResolvedValue([]);
    updatePresentacion.mockReset().mockResolvedValue({});
    createProducto.mockReset().mockResolvedValue({ id: "p-nuevo", sku: "X", name: "X" });
    createPresentacion.mockReset().mockResolvedValue({});
    auditar.mockReset().mockResolvedValue(undefined);
  });

  it("un código nuevo crea el producto y su presentación base, sin costo", async () => {
    const reporte = await correr([{ code: "7501055300013", name: "Coca 600", price: 18.5 }]);

    expect(reporte).toEqual({ created: 1, updated: 0 });
    expect(createProducto).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sku: "7501055300013", name: "Coca 600", baseUnit: "unit" }),
      }),
    );
    expect(createPresentacion).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          price: 18.5,
          cost: null,
          barcode: "7501055300013",
          isDefaultSale: true,
        }),
      }),
    );
  });

  it("lo que el negocio ya tiene actualiza SOLO el precio, nunca el nombre", async () => {
    findManyPresentaciones.mockResolvedValue([
      { id: "pres-1", barcode: "7501055300013", productId: "prod-1" },
    ]);

    // Se escanea la forma de 14: es el mismo producto escrito de otra manera.
    const reporte = await correr([
      { code: "07501055300013", name: "Otro nombre que no debe pisar", price: 21 },
    ]);

    expect(reporte).toEqual({ created: 0, updated: 1 });
    expect(updatePresentacion).toHaveBeenCalledWith({
      where: { id: "pres-1" },
      data: { price: 21 },
    });
    expect(createProducto).not.toHaveBeenCalled();
  });

  it("el mismo código dos veces rebota nombrando la línea donde ya estaba", async () => {
    await expect(
      correr([
        { code: "7501055300013", name: "Coca 600", price: 18.5 },
        { code: "7509999000006", name: "Otro", price: 10 },
        // La forma de 14 del primero: el mismo producto.
        { code: "07501055300013", name: "Coca 600 otra vez", price: 19 },
      ]),
    ).rejects.toMatchObject({
      response: {
        message: "products.quick_has_errors",
        errors: [
          {
            line: 3,
            itemCode: "07501055300013",
            message: "products.quick_duplicate_line",
            args: { line: 1 },
          },
        ],
      },
    });
    expect(createProducto).not.toHaveBeenCalled();
  });

  it("el sku que ya ocupa otro producto cae en SU línea, no como un 409 suelto", async () => {
    findManyProductos.mockResolvedValue([{ sku: "7509999000006" }]);

    await expect(
      correr([
        { code: "7501055300013", name: "Coca 600", price: 18.5 },
        { code: "7509999000006", name: "Chocaría", price: 10 },
      ]),
    ).rejects.toMatchObject({
      response: {
        errors: [
          { line: 2, itemCode: "7509999000006", field: "code", message: "products.sku_taken" },
        ],
      },
    });
    // Todo o nada: ni siquiera la línea buena se guardó.
    expect(createProducto).not.toHaveBeenCalled();
  });

  it("deja registro del lote en la auditoría, una vez y no sesenta", async () => {
    await correr([
      { code: "7501055300013", name: "Coca 600", price: 18.5 },
      { code: "7509999000006", name: "Otro", price: 10 },
    ]);

    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "products.quick_add",
        after: { created: 2, updated: 0, lines: 2 },
      }),
    );
  });
});
