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

/**
 * ── EJECUTAR el worker, no leerlo (2026-08-23) ────────────────────────────
 *
 * La versión anterior de estas pruebas buscaba el TEXTO `"esApi"` y los
 * nombres de las rutas dentro del archivo. Pasaba en verde mientras el worker
 * cacheaba `/api/pos/lookup` **en producción**: la guarda existía, decía
 * `/^\/(pos|inventory|…)/` sobre el pathname… y en producción el API vive en
 * `/api/pos/...`, que no empieza con `/pos`. Comprobar que una guarda ESTÁ
 * escrita no comprueba que FUNCIONE.
 *
 * Ahora el worker se ejecuta de verdad: se le inyecta un `self` falso, se le
 * pide el manejador de `fetch` y se le pasan peticiones reales. Lo que se
 * afirma es la DECISIÓN — responder desde el worker o dejar pasar a la red —
 * que es lo único que le importa a la caja.
 */
interface EventoFalso {
  request: { url: string; method: string; mode: string };
  respondWith: (r: unknown) => void;
  waitUntil: (p: unknown) => void;
}

function manejadorFetch(): (evento: EventoFalso) => void {
  const oyentes: Record<string, (e: EventoFalso) => void> = {};
  const selfFalso = {
    addEventListener: (evento: string, fn: (e: EventoFalso) => void) => {
      oyentes[evento] = fn;
    },
    location: { origin: "https://system.laradoc.com" },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const cachesFalso = {
    open: () => Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve() }),
    match: () => Promise.resolve(undefined),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  };
  new Function("self", "caches", "fetch", "Response", serviceWorker())(
    selfFalso,
    cachesFalso,
    () => Promise.resolve(new Response("")),
    Response,
  );
  const manejador = oyentes.fetch;
  if (manejador === undefined) {
    throw new Error("el worker no registró un manejador de `fetch`");
  }
  return manejador;
}

/** `true` si el worker DECIDE responder (o sea: puede servir de su caché). */
function elWorkerIntercepta(url: string, method = "GET", mode = "cors"): boolean {
  let intercepto = false;
  manejadorFetch()({
    request: { url, method, mode },
    respondWith: () => {
      intercepto = true;
    },
    waitUntil: () => undefined,
  });
  return intercepto;
}

const BASE = "https://system.laradoc.com";

describe("El service worker NO cachea el API (F4-PWA-01)", () => {
  /**
   * ⚠ LA INVARIANTE DEL MÓDULO, y la única que puede costar dinero.
   *
   * Un worker que sirve una respuesta guardada de `/api/pos/lookup` muestra el
   * stock de hace una hora, y el cajero vende mercancía que ya no está. Pasó:
   * medido en producción el 2026-08-23, con `/api/pos/lookup`,
   * `/api/pos/session` y `/api/me` dentro de la caché del worker.
   */
  it.each([
    "/api/pos/lookup?q=750",
    "/api/pos/session",
    "/api/pos/sales",
    "/api/inventory/expiring",
    "/api/products",
    "/api/warehouses",
    "/api/me",
    "/api/auth/refresh",
  ])("deja pasar %s a la red, sin tocarlo", (ruta) => {
    expect(elWorkerIntercepta(BASE + ruta)).toBe(false);
  });

  /**
   * El complemento del anterior: una lista de rutas prohibidas se queda corta
   * en cuanto nace un módulo nuevo. Lo que se fija es el criterio INVERSO —
   * solo el cascarón se cachea, y lo desconocido va a la red.
   */
  it("una ruta de API que todavía no existe TAMPOCO se cachea", () => {
    expect(elWorkerIntercepta(`${BASE}/api/reports/stock`)).toBe(false);
    expect(elWorkerIntercepta(`${BASE}/lo-que-sea`)).toBe(false);
  });

  it("sí sirve el cascarón: los assets con hash y el manifest", () => {
    expect(elWorkerIntercepta(`${BASE}/assets/index-A1b2C3.js`)).toBe(true);
    expect(elWorkerIntercepta(`${BASE}/manifest.webmanifest`)).toBe(true);
  });

  it("descarta todo lo que no sea GET", () => {
    // Un POST cacheado sería una venta fantasma que se reenvía sola.
    expect(elWorkerIntercepta(`${BASE}/assets/index-A1b2C3.js`, "POST")).toBe(false);
  });

  it("no toca otros dominios", () => {
    expect(elWorkerIntercepta("https://fonts.googleapis.com/css2?family=Inter")).toBe(false);
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
    // dispositivo para siempre. Y ahora además es lo que PURGA las cachés
    // envenenadas con respuestas del API: por eso la versión tuvo que subir.
    expect(serviceWorker()).toContain("caches.delete");
    expect(serviceWorker()).not.toContain("sellpoint-shell-v1");
  });
});
