import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { descargarBlob, dispararDescarga, imprimirPdf } from "./download";

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
});
