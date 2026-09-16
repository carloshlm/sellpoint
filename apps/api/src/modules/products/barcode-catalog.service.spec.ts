import { BarcodeCatalogService } from "./barcode-catalog.service";

/**
 * F10-QUICKCAT-02 — qué consulta se arma con qué, y sobre todo CUÁNTAS. La
 * base la prueban el integration spec y el e2e.
 */
describe("BarcodeCatalogService", () => {
  const findFirstPresentacion = jest.fn();
  const findUniqueGlobal = jest.fn();
  const findFirstRango = jest.fn();

  const service = new BarcodeCatalogService({
    withTenantContext: (_tenantId: string, cb: (tx: unknown) => unknown) =>
      cb({ productPresentation: { findFirst: findFirstPresentacion } }),
    globalBarcodeCatalog: { findUnique: findUniqueGlobal },
    gs1PrefixRange: { findFirst: findFirstRango },
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
  } as any);

  const usuario = { tenantId: "t-1" } as never;

  beforeEach(() => {
    findFirstPresentacion.mockReset().mockResolvedValue(null);
    findUniqueGlobal.mockReset().mockResolvedValue(null);
    findFirstRango.mockReset().mockResolvedValue({ isImportable: true });
  });

  it("si el negocio ya lo tiene, el catálogo global NI SE CONSULTA", async () => {
    findFirstPresentacion.mockResolvedValue({
      id: "pres-1",
      price: { toString: () => "18.50" },
      product: { id: "prod-1", sku: "7501055300013", name: "Coca 600" },
    });

    const resultado = await service.lookup(usuario, "7501055300013");

    expect(resultado.status).toBe("tenant");
    expect(resultado.tenant).toEqual({
      productId: "prod-1",
      presentationId: "pres-1",
      sku: "7501055300013",
      name: "Coca 600",
      price: "18.50",
    });
    expect(findUniqueGlobal).not.toHaveBeenCalled();
    expect(findFirstRango).not.toHaveBeenCalled();
  });

  it("busca en el catálogo propio todas las escrituras del mismo GTIN", async () => {
    await service.lookup(usuario, "7501055300013");
    expect(findFirstPresentacion).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barcode: { in: ["07501055300013", "7501055300013"] },
        }),
      }),
    );
  });

  it("lo que no conoce nadie vuelve como aportable si su prefijo lo admite", async () => {
    const resultado = await service.lookup(usuario, "7501055300013");

    expect(findUniqueGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gtin14: "07501055300013" } }),
    );
    expect(findFirstRango).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { prefixFrom: { lte: "750" }, prefixTo: { gte: "750" } },
      }),
    );
    expect(resultado.status).toBe("unknown");
    expect(resultado.contributable).toBe(true);
  });

  it("el catálogo global sugiere el nombre, y lo ya conocido no se vuelve a aportar", async () => {
    findUniqueGlobal.mockResolvedValue({
      productName: "Coca-Cola Original 600 ml",
      brand: "Coca-Cola",
      unitSize: "600 ml",
    });

    const resultado = await service.lookup(usuario, "7501055300013");

    expect(resultado.status).toBe("global");
    expect(resultado.global?.name).toBe("Coca-Cola Original 600 ml");
    expect(resultado.contributable).toBe(false);
    expect(findFirstRango).not.toHaveBeenCalled();
  });

  it("la etiqueta de báscula se busca y se da de alta, pero no se aporta", async () => {
    findFirstRango.mockResolvedValue({ isImportable: false });

    const resultado = await service.lookup(usuario, "2000000000015");

    expect(resultado.status).toBe("unknown");
    expect(resultado.gtin14).toBe("02000000000015");
    expect(resultado.contributable).toBe(false);
  });

  it("un código que no es un GTIN se busca literal y nunca llega al global", async () => {
    const resultado = await service.lookup(usuario, "INTERNO-42");

    expect(findFirstPresentacion).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ barcode: { in: ["INTERNO-42"] } }),
      }),
    );
    expect(findUniqueGlobal).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ status: "unknown", gtin14: null, contributable: false });
  });
});
