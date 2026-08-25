import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { descargarBlob, dispararDescarga } from "./download";

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
