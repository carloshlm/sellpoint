/**
 * F4-PWA-01 — registrar el service worker.
 *
 * ── Solo en producción, y por un motivo concreto ────────────────────────
 *
 * En desarrollo, un worker que cachea el cascarón sirve el JavaScript de hace
 * un rato y el hot-reload deja de tener efecto: se editan archivos y la
 * pantalla no cambia, sin una sola pista de por qué. Se pierde media hora
 * antes de acordarse de que hay un worker en medio.
 *
 * ── No se espera ni se bloquea nada ─────────────────────────────────────
 *
 * El registro es fuego y olvido: si falla —navegador viejo, contexto no
 * seguro, el usuario deshabilitó los workers— la app funciona igual. Un
 * `await` acá retrasaría el primer render por una capacidad que es un extra.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) {
    return;
  }
  if (!("serviceWorker" in navigator)) {
    return;
  }

  // Al `load` y no de inmediato: durante el arranque, el navegador está
  // bajando el JavaScript de la app, y pedirle además que registre un worker
  // le compite el ancho de banda a lo que el usuario está esperando ver.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silencio deliberado: no hay nada que el usuario pueda hacer con este
      // error, y la app ya funciona sin el worker.
    });
  });
}
