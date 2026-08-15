/**
 * D3 (#347, cierre de f1-web-onboard): los links de mail NUEVOS llevan el
 * token en el FRAGMENTO (`#token=...`), no en la query string — el
 * fragmento nunca viaja al servidor, así que nunca puede quedar en un
 * access log (spec #348, requirement "Los 3 links de mail pasan el token
 * por fragmento"). Con fallback a `?token=` (query) para ejercitar la
 * retrocompat de A5 del design — mismo contrato que el helper del front,
 * `apps/web/src/lib/auth/token-from-url.ts`.
 *
 * TODOS los e2e que canjean un link de mail capturado por `NoopMailer` DEBEN
 * pasar por acá — repetir el parseo archivo por archivo es exactamente cómo
 * este cambio se hubiera desincronizado en silencio (mismo espíritu que el
 * guardián `email-links.test.ts` del lado web).
 */
export function extractTokenFromLink(link: string | undefined): string | undefined {
  const url = new URL(link ?? "", "http://localhost");
  const hashToken = /^#token=(.+)$/.exec(url.hash)?.[1];
  if (hashToken) {
    return hashToken;
  }
  return url.searchParams.get("token") ?? undefined;
}
