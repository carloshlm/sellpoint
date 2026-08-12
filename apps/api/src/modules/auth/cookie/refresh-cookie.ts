import type { CookieOptions } from "express";

export const REFRESH_COOKIE_NAME = "sp_refresh";

export interface RefreshCookieEnv {
  NODE_ENV: string;
  REFRESH_COOKIE_PATH: string;
}

/**
 * f1-auth AD-5: la cookie de refresh NUNCA lleva el atributo `domain` — ni
 * siquiera vacío. `COOKIE_DOMAIN=""` en env.schema.ts es solo documentación
 * para prod; este builder no lo lee. Host-only por construcción, no por
 * configuración: no hay forma de que alguien complete esa var y rompa el
 * contrato D6 de vps-multidominio.
 */
export function buildRefreshCookieOptions(env: RefreshCookieEnv, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    // Safari rechaza `Secure` sobre http://localhost (design AD-5) — solo
    // prod corre HTTPS.
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: env.REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/** Logout / refresh fallido (AUTH-REQ-07, AD-5): mismos atributos, Max-Age=0. */
export function buildClearedRefreshCookieOptions(env: RefreshCookieEnv): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: env.REFRESH_COOKIE_PATH,
    maxAge: 0,
  };
}
