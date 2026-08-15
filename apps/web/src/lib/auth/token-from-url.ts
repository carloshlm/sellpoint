const HASH_TOKEN_PATTERN = /^#token=(.+)$/;

/**
 * D3 (#347, cierre de f1-web-onboard): helper ÚNICO compartido por
 * `/verify-email`, `/reset-password` y `/accept-invitation` para leer el
 * token del link de mail.
 *
 * Prioridad: `location.hash` (`#token=...`, el link NUEVO — el fragmento
 * jamás viaja al servidor, así que nunca queda en un access log) y, si no
 * hay, `location.search` (`?token=...`, el link VIEJO). El fallback a query
 * NO es opcional: la invitación vive 7 días y hay mails ya enviados con el
 * link viejo — romperlos deja gente afuera. Se retira 7 días después del
 * deploy de este cambio (deuda con fecha, no indefinida — ver DEFER.1).
 *
 * Tras leerlo, limpia la URL visible con `history.replaceState` para que el
 * secreto no quede en la barra de direcciones ni en el historial del
 * navegador (cierra de paso el S4 heredado de f1-web-auth en `/verify-email`).
 */
export function readTokenFromUrl(): string | undefined {
  const hashMatch = window.location.hash.match(HASH_TOKEN_PATTERN);
  if (hashMatch?.[1]) {
    const token = hashMatch[1];
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return token;
  }

  const legacyToken = new URLSearchParams(window.location.search).get("token");
  if (legacyToken) {
    window.history.replaceState(null, "", window.location.pathname);
    return legacyToken;
  }

  return undefined;
}
