/**
 * F6-WATCH-02 — Sentry del front, SOLO errores y SOLO en producción real.
 *
 * La MISMA imagen sirve en prod y sandbox, así que el DSN viaja bakeado en
 * ambas (un DSN de Sentry es público por diseño: vive en el JS del cliente).
 * El gate es el HOSTNAME en runtime — mismo criterio que el banner de
 * sandbox: sin él, cada experimento del sandbox ensuciaría el proyecto con
 * errores que nadie debe atender.
 *
 * El SDK se importa DINÁMICO: cuando Sentry está apagado (dev, sandbox, DSN
 * ausente), sus ~30 KB gzip ni siquiera se descargan.
 *
 * Tracing, replay y profiling APAGADOS a propósito (LEY de la Fase 6): con
 * 2-3 clientes, saber QUÉ error ocurrió vale la cuota free; medir cuánto
 * tarda cada request es peso sin retorno todavía.
 */

const PRODUCTION_HOSTNAME = "app.sellpointy.com";

export function shouldEnableSentry(hostname: string, dsn: string | undefined): boolean {
  return Boolean(dsn) && hostname === PRODUCTION_HOSTNAME;
}

/**
 * Las integraciones de fábrica SIN la de sesiones (Carlos, 2026-09-14).
 *
 * `@sentry/browser` 10 trae `BrowserSession` encendida por defecto: manda un
 * aviso de sesión en CADA carga de página, haya error o no. La LEY de esta
 * integración es «solo errores», y ese aviso nadie lo pidió — fue el que
 * delató en la consola que la CSP bloqueaba a Sentry, porque salía en el
 * panel sin que nada fallara. Se filtra por NOMBRE para conservar todo lo
 * demás que captura errores (handlers globales, errores enlazados, dedupe…).
 */
export function sinSesiones<T extends { name: string }>(integraciones: T[]): T[] {
  return integraciones.filter((integracion) => integracion.name !== "BrowserSession");
}

export function installSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!shouldEnableSentry(window.location.hostname, dsn)) {
    return;
  }

  void import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn,
      // Solo captura de errores: nada de transacciones.
      tracesSampleRate: 0,
      // Ni avisos de sesión en cada carga de página: ver `sinSesiones`.
      integrations: sinSesiones,
      // F6-RELEASE-04: los errores se agrupan por versión desplegada.
      release: `sellpoint@${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}`,
    });
  });
}
