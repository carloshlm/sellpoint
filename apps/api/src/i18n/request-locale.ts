import type { IncomingHttpHeaders } from "node:http";
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@sellpoint/shared";

export interface LocaleAwareRequest {
  headers: IncomingHttpHeaders;
}

export type RequestWithLocale = LocaleAwareRequest & { locale?: Locale };

/**
 * F1-LOCALE-02: cascada de resolución de locale.
 *
 * 1. `user.locale` (autenticado) — decodificado del claim `locale` del
 *    access token, SIN verificar firma. Es solo una pista de UX (idioma de
 *    la respuesta), no una decisión de autorización — esa la sigue haciendo
 *    JwtAuthGuard con verificación RS256 completa. Un token corrupto o sin
 *    claim acá simplemente degrada a la siguiente rama, nunca lanza.
 * 2. `Accept-Language` (soportado) — primer idioma del header que matchea
 *    `SUPPORTED_LOCALES`, respetando el q-value más alto.
 * 3. `DEFAULT_LOCALE`.
 */
export function resolveLocale(req: LocaleAwareRequest): Locale {
  return (
    decodeLocaleFromBearerToken(req.headers.authorization) ??
    parseAcceptLanguage(req.headers["accept-language"]) ??
    DEFAULT_LOCALE
  );
}

/** Lee `req.locale` (seteado por `LocaleResolverMiddleware`); si no corrió, DEFAULT_LOCALE. */
export function getLocale(req: { locale?: Locale }): Locale {
  return req.locale ?? DEFAULT_LOCALE;
}

function decodeLocaleFromBearerToken(header: string | undefined): Locale | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  const token = header.slice("Bearer ".length).trim();
  const segments = token.split(".");
  const payloadSegment = segments[1];
  if (segments.length !== 3 || !payloadSegment) {
    return undefined;
  }

  try {
    const payloadJson = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { locale?: unknown };
    return isSupportedLocale(payload.locale) ? payload.locale : undefined;
  } catch {
    return undefined;
  }
}

function parseAcceptLanguage(header: string | string[] | undefined): Locale | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    return undefined;
  }

  const candidates = raw
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of candidates) {
    const primary = tag.split("-")[0];
    if (isSupportedLocale(primary)) {
      return primary;
    }
  }

  return undefined;
}

function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
