const HASH_TOKEN_PATTERN = /^#token=(.+)$/;

/**
 * D3 (#347, cierre de f1-web-onboard): helper ÚNICO compartido por
 * `/verify-email`, `/reset-password` y `/accept-invitation` para leer el
 * token del link de mail.
 *
 * El token viaja en `location.hash` (`#token=...`): el fragmento **jamás viaja
 * al servidor**, así que nunca queda en un access log, en un Referer ni en el
 * historial de un proxy. La query string sí viaja, y por eso se descartó.
 *
 * ── DEFER.1 cerrada (2026-08-21) ────────────────────────────────────────
 * Hubo un fallback a `?token=` para no romper los mails ya enviados con el
 * formato viejo. Se retiró cuando venció el último link posible: el deploy de
 * D3 fue el **2026-08-15** y el TTL más largo es el de la invitación (7 días),
 * así que el 22 ya no podía quedar ninguno vivo — la verificación (24 h) y el
 * reset (30 min) habían vencido mucho antes. La deuda nació con fecha
 * justamente para que retirarla fuera una cuenta y no una discusión.
 *
 * Se retiró el **21**, un día antes, porque la fecha era el proxy de una
 * pregunta MEDIBLE y se midió: en producción no quedaba un solo token sin
 * usar anterior al deploy de D3.
 *
 * Un `?token=` que llegue hoy se IGNORA. Aceptarlo "por si acaso" mantendría
 * viva la vía que este cambio vino a cerrar.
 *
 * Tras leerlo, limpia la URL visible con `history.replaceState` para que el
 * secreto no quede en la barra de direcciones ni en el historial del
 * navegador (cierra de paso el S4 heredado de f1-web-auth en `/verify-email`).
 */
export function readTokenFromUrl(): string | undefined {
  const hashMatch = window.location.hash.match(HASH_TOKEN_PATTERN);
  if (!hashMatch?.[1]) {
    return undefined;
  }

  const token = hashMatch[1];
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return token;
}
