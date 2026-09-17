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

  const usuario = { tenantId: "t-1", locale: "es" } as never;
  const enIngles = { tenantId: "t-1", locale: "en" } as never;

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
      nameEs: "Coca-Cola Original 600 ml",
      nameEn: null,
      nameLang: "es",
      brand: "Coca-Cola",
      unitSize: "600 ml",
    });

    const resultado = await service.lookup(usuario, "7501055300013");

    expect(resultado.status).toBe("global");
    expect(resultado.global?.name).toBe("Coca-Cola Original 600 ml");
    expect(resultado.global?.lang).toBe("es");
    expect(resultado.contributable).toBe(false);
    expect(findFirstRango).not.toHaveBeenCalled();
  });

  /**
   * F10-LANG — el caso que lo originó: Carlos escaneó un aceite en Canadá y la
   * pantalla le sugirió el francés.
   */
  it("con el nombre en tu idioma, ese gana y se anuncia como tuyo", async () => {
    findUniqueGlobal.mockResolvedValue({
      productName: "Huile d'olive vierge extra",
      nameEs: null,
      nameEn: "Extra Virgin Olive Oil",
      nameLang: "fr",
      brand: "Terra Delyssa",
      unitSize: "1 L",
    });

    const resultado = await service.lookup(enIngles, "6191509903627");

    expect(resultado.global).toMatchObject({ name: "Extra Virgin Olive Oil", lang: "en" });
  });

  it("sin nombre en tu idioma se sugiere el que hay, DICIENDO en qué idioma está", async () => {
    findUniqueGlobal.mockResolvedValue({
      productName: "Huile d'olive vierge extra",
      nameEs: null,
      nameEn: null,
      nameLang: "fr",
      brand: "Terra Delyssa",
      unitSize: "1 L",
    });

    const resultado = await service.lookup(enIngles, "6191509903627");

    // Se sugiere igual: con su marca al lado alcanza para reconocer la botella
    // que se tiene en la mano. Lo que no se hace es disimular el idioma.
    expect(resultado.global).toMatchObject({ name: "Huile d'olive vierge extra", lang: "fr" });
  });

  /**
   * Carlos (2026-09-16): «aún me sale el nombre en francés y no en inglés para
   * ese producto que sí tiene valor en su nombre en inglés». Tenía razón — el
   * respaldo saltaba del español al original y se saltaba el inglés, que es
   * uno de los dos idiomas que la aplicación habla.
   */
  it("sin nombre en tu idioma gana el OTRO que hablamos, no el original", async () => {
    findUniqueGlobal.mockResolvedValue({
      productName: "Huile d'olive vierge extra",
      nameEs: null,
      nameEn: "Extra Virgin Olive Oil",
      nameLang: "fr",
      brand: "Terra Delyssa",
      unitSize: "1 L",
    });

    const resultado = await service.lookup(usuario, "6191509903627");

    expect(resultado.global).toMatchObject({ name: "Extra Virgin Olive Oil", lang: "en" });
  });

  it("una fila del volcado viejo no dice su idioma, y eso no se inventa", async () => {
    findUniqueGlobal.mockResolvedValue({
      productName: "Zucaritas",
      nameEs: null,
      nameEn: null,
      nameLang: null,
      brand: "Kellogg's",
      unitSize: null,
    });

    const resultado = await service.lookup(usuario, "7501008042984");

    expect(resultado.global).toMatchObject({ name: "Zucaritas", lang: null });
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
