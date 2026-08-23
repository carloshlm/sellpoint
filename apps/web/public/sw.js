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
 *
 * **v2 (2026-08-23) no es cosmética: PURGA las cachés envenenadas.** La v1
 * guardó respuestas de `/api/pos/lookup`, `/api/pos/session` y `/api/me` en
 * los dispositivos que ya abrieron la app. Sin subir la versión, esos equipos
 * seguirían sirviendo stock viejo aunque el código nuevo ya no cachee nada
 * del API.
 */
const CACHE = "sellpoint-shell-v2";

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

  // ── Solo el CASCARÓN se cachea; lo demás va a la red ─────────────────
  //
  // Esto era una lista NEGRA («todo se cachea salvo estas rutas») y costó
  // caro: se escribió cuando el API vivía en otro host, y en producción el
  // deploy lo dejó en `/api` del MISMO dominio. El patrón miraba
  // `/^\/(pos|inventory|…)/` sobre el pathname, y `/api/pos/lookup` no
  // empieza con `/pos` — así que el worker se puso a cachear el API entero.
  // Medido el 2026-08-23 en producción: `/api/pos/lookup`, `/api/pos/session`
  // y `/api/me` dentro de la caché, con el POS mostrando stock viejo hasta
  // recargar a mano. El docblock de arriba juraba que eso no podía pasar.
  //
  // La lección: **una lista negra falla en silencio y hacia el lado
  // peligroso.** Basta que nazca un módulo, cambie un prefijo o se mueva el
  // API para que algo nuevo entre a la caché sin que nadie lo decida. La
  // lista BLANCA falla hacia el lado seguro: lo que no está nombrado va a la
  // red, y el costo de equivocarse es una petición de más.
  const esDelSitio = url.origin === self.location.origin;
  const esCascaron =
    esDelSitio &&
    // Los assets de Vite llevan hash: su URL cambia cuando cambia el
    // contenido, así que cachearlos no puede servir código viejo.
    (url.pathname.startsWith("/assets/") ||
      SHELL.includes(url.pathname) ||
      /\.(?:css|js|woff2?|ttf|svg|png|ico|webmanifest)$/.test(url.pathname));

  if (!esCascaron) {
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

  // ── Cascarón: caché primero, y se refresca de fondo ───────────────────
  //
  // Acá ya solo llega lo que pasó la lista blanca de arriba: archivos con
  // hash o del cascarón. Un archivo cacheado NUNCA queda viejo, porque si el
  // contenido cambia, cambia la URL. Por eso el caché puede ir primero.
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
