import { afterEach, describe, expect, it } from "vitest";
import { readTokenFromUrl } from "./token-from-url";

/**
 * D3 (#347, cierre de f1-web-onboard): el token de un link de mail viaja por
 * `location.hash`, no por query string — así nunca aparece en un access log de
 * servidor (el fragmento no viaja al servidor, la query sí).
 *
 * ── DEFER.1, retirada del fallback (2026-08-22) ─────────────────────────
 * El fallback a `?token=` existió para no romper los mails ya enviados con el
 * formato viejo. Se retiró cuando venció el último: el deploy de D3 fue el
 * 2026-08-15 y la invitación —el TTL más largo, 7 días— expiraba el 22. La
 * verificación (24 h) y el reset (30 min) habían vencido mucho antes.
 *
 * A partir de acá, un `?token=` en la URL es un token que viajó por un canal
 * que se descartó a propósito: se IGNORA. Aceptarlo "por las dudas" mantendría
 * viva justo la vía que este cambio vino a cerrar.
 */
describe("readTokenFromUrl", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("lee el token de location.hash (#token=) cuando está presente", () => {
    window.history.pushState(null, "", "/verify-email#token=tok-del-fragmento");

    expect(readTokenFromUrl()).toBe("tok-del-fragmento");
  });

  it("limpia el hash de la URL visible después de leerlo (no deja el secreto en la barra)", () => {
    window.history.pushState(null, "", "/verify-email#token=tok-del-fragmento");

    readTokenFromUrl();

    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/verify-email");
  });

  it("un `?token=` en la query se IGNORA: ese canal quedó retirado", () => {
    window.history.pushState(null, "", "/reset-password?token=tok-legacy");

    expect(readTokenFromUrl()).toBeUndefined();
  });

  it("el hash sigue leyéndose aunque la query traiga otro token", () => {
    // Un link raro o manipulado no debe poder colar el token por la query.
    window.history.pushState(null, "", "/accept-invitation?token=tok-viejo#token=tok-nuevo");

    expect(readTokenFromUrl()).toBe("tok-nuevo");
  });

  it("sin hash no toca el historial ni la query", () => {
    window.history.pushState(null, "", "/reset-password?token=tok-legacy");

    readTokenFromUrl();

    // La URL se deja como está: ya no hay nada que leer ahí, y reescribirla
    // sugeriría que el token se usó.
    expect(window.location.search).toBe("?token=tok-legacy");
  });

  it("sin hash ni query devuelve undefined y no toca el historial", () => {
    window.history.pushState(null, "", "/verify-email");

    expect(readTokenFromUrl()).toBeUndefined();
    expect(window.location.pathname).toBe("/verify-email");
  });

  it("un hash vacío (#token=) se trata como ausente", () => {
    window.history.pushState(null, "", "/verify-email#token=");

    expect(readTokenFromUrl()).toBeUndefined();
  });
});
