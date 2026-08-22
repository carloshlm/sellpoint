/**
 * F4-PWA-01 — el service worker.
 *
 * ── La regla que lo gobierna: el API NUNCA se cachea ────────────────────
 *
 * Es la decisión entera de este archivo. Un service worker que sirve una
 * respuesta guardada de `/pos/lookup` mostraría el stock de hace una hora, y
 * el cajero vendería mercancía que ya no está. **Vender sin poder validar
 * stock es regalar inventario** — por eso, offline, las llamadas al API FALLAN
 * y la pantalla lo dice, en vez de mentir con datos viejos.
 *
 * Lo que sí se cachea es el CASCARÓN: el HTML, el JavaScript, el CSS y las
 * fuentes. Con eso la app abre sin red y puede explicar qué no puede hacer, en
 * lugar de mostrar el dinosaurio del navegador.
 *
 * ── Por qué a mano y no con `vite-plugin-pwa` ───────────────────────────
 *
 * El plugin precachea la lista de archivos que produce el build, con sus
 * hashes. Eso hace falta cuando se quiere que TODO esté disponible offline
 * desde el primer arranque. Acá no: lo que importa es que la app abra, y para
 * eso alcanza con guardar lo que el usuario ya visitó. A cambio, este archivo
 * se lee entero en dos minutos y no agrega una dependencia que hay que
 * mantener al día con el bundler.
 */

/**
 * Sube cuando cambie la estrategia. Al cambiar, el `activate` borra las
 * versiones viejas: sin eso, cada despliegue dejaría un caché huérfano
 * ocupando espacio en el dispositivo para siempre.
 */
const CACHE = "sellpoint-shell-v1";

/** El cascarón mínimo: sin esto la app no arranca. */
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  // `skipWaiting` para que una versión nueva tome control sin esperar a que se
  // cierren todas las pestañas: en una tablet de mostrador, esa espera puede
  // ser de días.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo GET. Un POST cacheado sería una venta fantasma que se reenvía sola.
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // ── El API queda AFUERA, siempre ──────────────────────────────────────
  //
  // Se reconoce por origen distinto (el API vive en otro host) o por las rutas
  // conocidas si algún día comparten dominio. Ante la duda, NO se cachea: el
  // costo de no cachear es una llamada de red, y el de cachear de más es
  // vender contra un inventario que no existe.
  const esApi =
    url.origin !== self.location.origin ||
    /^\/(pos|inventory|products|services|warehouses|catalogs|auth|me|users|roles|tenants)\b/.test(
      url.pathname,
    );
  if (esApi) {
    return;
  }

  // ── Navegación: red primero, cascarón si no hay ───────────────────────
  //
  // Red primero y no caché primero: con red, el usuario tiene que ver la
  // versión desplegada hoy. El caché es la red de emergencia, no la fuente.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // ── Estáticos: caché primero, y se refresca de fondo ──────────────────
  //
  // Los assets de Vite llevan hash en el nombre, así que un archivo cacheado
  // NUNCA queda viejo: si el contenido cambia, cambia la URL. Por eso acá el
  // caché sí puede ir primero sin riesgo de servir código de ayer.
  event.respondWith(
    caches.match(request).then((cached) => {
      const deRed = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copia = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copia));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());

      return cached ?? deRed;
    }),
  );
});
