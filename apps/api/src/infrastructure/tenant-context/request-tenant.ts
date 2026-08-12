import type { IncomingHttpHeaders } from "node:http";

export interface TenantAwareRequest {
  headers: IncomingHttpHeaders;
}

export type RequestWithTenant = TenantAwareRequest & { tenantId?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F1-TENANT-01: decodifica el claim `tenantId` del Bearer token SIN
 * verificar firma — mismo patrón que `resolveLocale` (F1-LOCALE-02,
 * `request-locale.ts`). Es SOLO un dato de observabilidad de request; la
 * verificación real de la firma sigue siendo `JwtAuthGuard` (RS256 +
 * iss/aud), y la ÚNICA fuente de confianza para RLS sigue siendo
 * `PrismaService.withTenantContext` / `withNewTenantContext`
 * (`set_config` transaction-scoped, f1-auth AD-1).
 *
 * Deliberadamente NO ejecuta `set_config` acá: esa opción ("set_config en
 * middleware, no-local") fue evaluada y RECHAZADA en el design de f1-auth
 * (AD-1) porque con connection pooling el contexto se pierde o se cruza
 * entre tenants — un middleware corre en una conexión que el pool puede
 * reciclar antes de que la query de dominio se ejecute en otra.
 */
export function resolveTenantId(req: TenantAwareRequest): string | undefined {
  const header = req.headers.authorization;
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
    const payload = JSON.parse(payloadJson) as { tenantId?: unknown };
    return isUuid(payload.tenantId) ? payload.tenantId : undefined;
  } catch {
    return undefined;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
