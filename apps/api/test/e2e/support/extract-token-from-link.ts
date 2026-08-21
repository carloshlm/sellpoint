/**
 * D3 (#347, cierre de f1-web-onboard): los links de mail llevan el token en el
 * FRAGMENTO (`#token=...`), no en la query string — el fragmento nunca viaja
 * al servidor, así que nunca puede quedar en un access log (spec #348,
 * requirement "Los 3 links de mail pasan el token por fragmento").
 *
 * DEFER.1 (2026-08-21): se retiró el fallback a `?token=`, que existía solo
 * para los mails ya enviados con el formato viejo. Este helper es el espejo de
 * `apps/web/src/lib/auth/token-from-url.ts` y tiene que aceptar EXACTAMENTE lo
 * mismo que el front: si acá siguiera tolerando la query, un mail que volviera
 * a emitirla pasaría los e2e y rompería en el navegador.
 *
 * TODOS los e2e que canjean un link de mail capturado por `NoopMailer` DEBEN
 * pasar por acá — repetir el parseo archivo por archivo es exactamente cómo
 * este cambio se hubiera desincronizado en silencio (mismo espíritu que el
 * guardián `email-links.test.ts` del lado web).
 */
export function extractTokenFromLink(link: string | undefined): string | undefined {
  const url = new URL(link ?? "", "http://localhost");
  return /^#token=(.+)$/.exec(url.hash)?.[1];
}
