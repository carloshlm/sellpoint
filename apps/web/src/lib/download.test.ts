import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { descargarBlob, dispararDescarga, imprimirPdf, nombreDeDescarga } from "./download";

/**
 * F5-HUB-01 — la secuencia de descarga, en UN solo lugar.
 *
 * Vivía copiada en cuatro archivos (catálogo, inventario ×2, POS). No es una
 * duplicación cosmética: cada copia decide por su cuenta cuándo revocar el
 * `objectURL`, y revocar demasiado pronto deja al usuario con un archivo vacío
 * o una ventana en blanco. Con cuatro copias, esa decisión se toma cuatro
 * veces y se arregla en una.
 */
describe("helper de descarga", () => {
  let click: ReturnType<typeof vi.fn>;
  let creados: string[];
  let revocados: string[];

  beforeEach(() => {
    creados = [];
    revocados = [];
    click = vi.fn();

    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:test-${creados.length}`;
        creados.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revocados.push(url)),
    });

    vi.spyOn(document, "createElement").mockImplementation(((etiqueta: string) => {
      if (etiqueta !== "a") {
        throw new Error(`no esperaba crear un <${etiqueta}>`);
      }
      return { href: "", download: "", click } as unknown as HTMLElement;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("descargarBlob", () => {
    it("crea el enlace, lo dispara y revoca la URL", async () => {
      await descargarBlob(new Blob(["hola"]), "reporte.xlsx");

      expect(click).toHaveBeenCalledTimes(1);
      expect(creados).toHaveLength(1);
      // Revocar es lo que evita que el blob quede colgado en memoria hasta
      // que se cierre la pestaña.
      expect(revocados).toEqual(creados);
    });

    it("el archivo baja con el nombre que se pidió", async () => {
      const enlaces: { download: string }[] = [];
      vi.spyOn(document, "createElement").mockImplementation((() => {
        const enlace = { href: "", download: "", click };
        enlaces.push(enlace);
        return enlace as unknown as HTMLElement;
      }) as typeof document.createElement);

      await descargarBlob(new Blob(["x"]), "ventas.csv");

      expect(enlaces[0]?.download).toBe("ventas.csv");
    });
  });

  describe("dispararDescarga", () => {
    /**
     * La primitiva sin revocación, para quien todavía necesita la URL viva:
     * el ticket del POS la abre en una ventana que sigue cargando, y revocarla
     * ahí la deja en blanco.
     */
    it("dispara el enlace pero NO revoca: la URL sigue en uso", () => {
      dispararDescarga("blob:existente", "ticket.pdf");

      expect(click).toHaveBeenCalledTimes(1);
      expect(revocados).toEqual([]);
    });
  });
});

/**
 * El papel del turno (Carlos, 2026-09-02): «directamente el cuadro de
 * impresión». El PDF se carga en un iframe oculto y se imprime desde ahí, sin
 * pestaña nueva ni Cmd+P: la recepcionista solo confirma en el cuadro.
 */
describe("imprimirPdf", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test-papel"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const frame of document.querySelectorAll("iframe")) frame.remove();
  });

  function frameDeImpresion(): HTMLIFrameElement {
    const frame = document.querySelector("iframe");
    if (!frame) throw new Error("no hay iframe de impresión");
    return frame;
  }

  it("carga el PDF en un iframe oculto y abre el cuadro de impresión al terminar de cargar", () => {
    const abrir = vi.spyOn(window, "open").mockReturnValue(null);
    imprimirPdf(new Blob(["%PDF"]), "turno-7.pdf");

    const frame = frameDeImpresion();
    expect(frame.src).toBe("blob:test-papel");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    const print = vi.fn();
    Object.defineProperty(frame, "contentWindow", {
      value: { focus: vi.fn(), print, location: { href: "blob:test-papel" } },
    });
    frame.dispatchEvent(new Event("load"));

    expect(print).toHaveBeenCalledTimes(1);
    expect(abrir).not.toHaveBeenCalled();
  });

  it("si el navegador no deja imprimir el iframe, abre el PDF en una pestaña", () => {
    const abrir = vi.spyOn(window, "open").mockReturnValue({} as Window);
    imprimirPdf(new Blob(["%PDF"]), "turno-7.pdf");

    const frame = frameDeImpresion();
    Object.defineProperty(frame, "contentWindow", {
      value: {
        focus: vi.fn(),
        print: () => {
          throw new Error("bloqueado");
        },
      },
    });
    frame.dispatchEvent(new Event("load"));

    expect(abrir).toHaveBeenCalledWith("blob:test-papel");
  });

  it("si el navegador bloqueó la carga (CSP) y el iframe quedó en blanco, abre el PDF en una pestaña sin imprimir", () => {
    const abrir = vi.spyOn(window, "open").mockReturnValue({} as Window);
    imprimirPdf(new Blob(["%PDF"]), "turno-7.pdf");

    const frame = frameDeImpresion();
    const print = vi.fn();
    Object.defineProperty(frame, "contentWindow", {
      value: { focus: vi.fn(), print, location: { href: "about:blank" } },
    });
    frame.dispatchEvent(new Event("load"));

    expect(print).not.toHaveBeenCalled();
    expect(abrir).toHaveBeenCalledWith("blob:test-papel");
  });

  it("un papel nuevo reemplaza al anterior: un solo iframe y la URL vieja liberada", () => {
    imprimirPdf(new Blob(["1"]), "turno-1.pdf");
    imprimirPdf(new Blob(["2"]), "turno-2.pdf");

    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  /**
   * Carlos (2026-10-31): «Guardar como PDF» proponía «SellPointy.pdf» para el
   * ticket VTA-000105. Chrome nombra el archivo con el título de la PESTAÑA,
   * no con el del iframe ni el del PDF.
   */
  describe("el nombre que propone «Guardar como PDF»", () => {
    /** Imprime el papel y devuelve el título que tenía la pestaña al abrir el cuadro. */
    function imprimirYLeerTitulo(filename: string): string {
      let titulo = "";
      imprimirPdf(new Blob(["%PDF"]), filename);
      const frame = frameDeImpresion();
      Object.defineProperty(frame, "contentWindow", {
        value: {
          focus: vi.fn(),
          print: () => {
            titulo = document.title;
          },
          location: { href: "blob:test-papel" },
        },
      });
      frame.dispatchEvent(new Event("load"));
      return titulo;
    }

    beforeEach(() => {
      document.title = "SellPointy";
    });

    afterEach(() => {
      document.dispatchEvent(new Event("pointerdown"));
    });

    it("al abrir el cuadro, la pestaña se llama como el folio (sin «.pdf», Chrome lo agrega)", () => {
      expect(imprimirYLeerTitulo("VTA-000105.pdf")).toBe("VTA-000105");
    });

    it("la pestaña recupera su título con el primer clic después de imprimir", () => {
      imprimirYLeerTitulo("VTA-000105.pdf");
      expect(document.title).toBe("VTA-000105");

      document.dispatchEvent(new Event("pointerdown"));

      expect(document.title).toBe("SellPointy");
    });

    it("o con la primera tecla (el lector de códigos del siguiente cliente)", () => {
      imprimirYLeerTitulo("VTA-000105.pdf");

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "7" }));

      expect(document.title).toBe("SellPointy");
    });

    it("dos papeles seguidos: la pestaña vuelve a SU título, no al folio del primero", () => {
      imprimirYLeerTitulo("VTA-000105.pdf");
      expect(imprimirYLeerTitulo("VTA-000106.pdf")).toBe("VTA-000106");

      document.dispatchEvent(new Event("pointerdown"));

      expect(document.title).toBe("SellPointy");
    });

    it("si el papel se abre en pestaña porque el iframe no imprime, el título no cambia", () => {
      vi.spyOn(window, "open").mockReturnValue({} as Window);
      imprimirPdf(new Blob(["%PDF"]), "VTA-000105.pdf");
      const frame = frameDeImpresion();
      Object.defineProperty(frame, "contentWindow", {
        value: { focus: vi.fn(), print: vi.fn(), location: { href: "about:blank" } },
      });
      frame.dispatchEvent(new Event("load"));

      expect(document.title).toBe("SellPointy");
    });

    it("si el iframe rechaza imprimir y el papel se va a una pestaña, la de SellPointy conserva su título", () => {
      vi.spyOn(window, "open").mockReturnValue({} as Window);
      imprimirPdf(new Blob(["%PDF"]), "VTA-000105.pdf");
      const frame = frameDeImpresion();
      Object.defineProperty(frame, "contentWindow", {
        value: {
          focus: vi.fn(),
          print: () => {
            throw new Error("bloqueado");
          },
          location: { href: "blob:test-papel" },
        },
      });
      frame.dispatchEvent(new Event("load"));

      expect(document.title).toBe("SellPointy");
    });
  });
});

/**
 * El nombre lo decide el API en el idioma del usuario y viaja en
 * `Content-Disposition`; el web lo lee de ahí y solo cae al de siempre si
 * no viene.
 */
describe("nombreDeDescarga", () => {
  it('lee filename="…" del encabezado', () => {
    expect(
      nombreDeDescarga({ "content-disposition": 'attachment; filename="products.csv"' }, "x.csv"),
    ).toBe("products.csv");
  });

  it("entiende la forma extendida con UTF-8 y la decodifica", () => {
    expect(
      nombreDeDescarga(
        { "content-disposition": "attachment; filename*=UTF-8''conteo%20f%C3%ADsico.xlsx" },
        "x.xlsx",
      ),
    ).toBe("conteo físico.xlsx");
  });

  it("sin encabezado, o sin nombre en él, usa el respaldo", () => {
    expect(nombreDeDescarga(undefined, "productos.csv")).toBe("productos.csv");
    expect(nombreDeDescarga({}, "productos.csv")).toBe("productos.csv");
    expect(nombreDeDescarga({ "content-disposition": "attachment" }, "productos.csv")).toBe(
      "productos.csv",
    );
  });
});
