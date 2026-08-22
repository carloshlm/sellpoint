import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: el contrato de la app instalable.
 *
 * Nada de esto se puede probar con `render()`: un manifest y un service worker
 * son archivos estáticos que el navegador lee, no código que la app importe.
 * Sin este test, romperlos no pone nada rojo — el fallo aparece semanas
 * después, cuando alguien nota que la app ya no se instala o, peor, que el POS
 * está vendiendo contra stock cacheado.
 */
const PUBLIC = join(__dirname, "../../../public");

const manifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as Record<string, unknown>;

const serviceWorker = (): string => readFileSync(join(PUBLIC, "sw.js"), "utf8");

describe("El manifest hace la app INSTALABLE (F4-PWA-01)", () => {
  it("declara nombre, arranque y `standalone`", () => {
    const m = manifest();

    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/");
    // Sin `standalone` el navegador la abre en una pestaña con barra de
    // direcciones: se ve como una web, no como la app de la caja.
    expect(m.display).toBe("standalone");
  });

  /**
   * ⚠ Android RECORTA el icono con la forma que el fabricante elija. Sin un
   * icono `maskable`, el sistema recorta el normal y se lleva las puntas del
   * logo — o peor, deja esquinas transparentes.
   */
  it("trae un icono `maskable` además del normal", () => {
    const icons = manifest().icons as { purpose?: string; src: string }[];

    expect(icons.some((i) => i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("cada icono declarado EXISTE en disco", () => {
    const icons = manifest().icons as { src: string }[];
    const faltan = icons
      .map((i) => i.src.replace(/^\//, ""))
      .filter((src) => {
        try {
          readFileSync(join(PUBLIC, src));
          return false;
        } catch {
          return true;
        }
      });

    // Un icono declarado y ausente hace que la instalación falle en silencio.
    expect({ faltan }).toEqual({ faltan: [] });
  });
});

describe("El service worker NO cachea el API (F4-PWA-01)", () => {
  /**
   * ⚠ LA INVARIANTE DEL MÓDULO, y la única que puede costar dinero.
   *
   * Un worker que sirve una respuesta guardada de `/pos/lookup` mostraría el
   * stock de hace una hora, y el cajero vendería mercancía que ya no está.
   * Este test no puede ejecutar el worker —no hay `ServiceWorkerGlobalScope`
   * en jsdom— así que verifica que la GUARDA siga escrita: el día que alguien
   * la quite «para que ande más rápido», esto se pone rojo.
   */
  it("tiene la guarda que descarta las rutas del API", () => {
    const sw = serviceWorker();

    expect(sw).toContain("esApi");
    // Las rutas que mueven dinero o inventario, nombradas explícitamente.
    for (const ruta of ["pos", "inventory", "products", "auth"]) {
      expect(sw).toContain(ruta);
    }
  });

  it("descarta todo lo que no sea GET", () => {
    // Un POST cacheado sería una venta fantasma que se reenvía sola.
    expect(serviceWorker()).toContain('request.method !== "GET"');
  });

  it("la navegación va a la RED primero", () => {
    const sw = serviceWorker();

    // Caché primero en la navegación serviría la versión de ayer a alguien que
    // tiene red perfecta. El caché es la red de emergencia, no la fuente.
    const navegacion = sw.slice(sw.indexOf('request.mode === "navigate"'));
    expect(navegacion.indexOf("fetch(request)")).toBeLessThan(navegacion.indexOf("caches.match"));
  });

  it("limpia las versiones viejas del caché al activarse", () => {
    // Sin esto, cada despliegue deja un caché huérfano ocupando espacio en el
    // dispositivo para siempre.
    expect(serviceWorker()).toContain("caches.delete");
  });
});
