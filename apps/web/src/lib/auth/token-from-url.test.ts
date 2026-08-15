import { afterEach, describe, expect, it } from "vitest";
import { readTokenFromUrl } from "./token-from-url";

/**
 * D3 (#347, cierre de f1-web-onboard): el token de un link de mail viaja por
 * `location.hash`, no por query string — así nunca aparece en un access log
 * de servidor (el fragmento no viaja al servidor, la query sí). El fallback
 * a `?token=` es OBLIGATORIO (A5 del design): hay mails ya enviados con links
 * viejos y la invitación vive 7 días — no se puede romper esos links.
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

  it("sin hash, cae a location.search (?token=) — retrocompat de mails ya enviados", () => {
    window.history.pushState(null, "", "/reset-password?token=tok-legacy");

    expect(readTokenFromUrl()).toBe("tok-legacy");
  });

  it("también limpia la query string legacy después de leerla", () => {
    window.history.pushState(null, "", "/reset-password?token=tok-legacy");

    readTokenFromUrl();

    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/reset-password");
  });

  it("el hash tiene prioridad sobre la query si ambos están presentes", () => {
    window.history.pushState(null, "", "/accept-invitation?token=tok-viejo#token=tok-nuevo");

    expect(readTokenFromUrl()).toBe("tok-nuevo");
  });

  it("sin hash ni query devuelve undefined y no toca el historial", () => {
    window.history.pushState(null, "", "/verify-email");

    expect(readTokenFromUrl()).toBeUndefined();
    expect(window.location.pathname).toBe("/verify-email");
  });

  it("un token vacío en query (?token=) se trata como ausente", () => {
    window.history.pushState(null, "", "/verify-email?token=");

    expect(readTokenFromUrl()).toBeUndefined();
  });
});
