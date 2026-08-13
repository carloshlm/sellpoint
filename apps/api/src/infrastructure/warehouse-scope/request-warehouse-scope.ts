import type { IncomingHttpHeaders } from "node:http";

export interface UserScope {
  warehouseIds: string[] | "all";
}

export interface WarehouseScopeAwareRequest {
  headers: IncomingHttpHeaders;
}

export type RequestWithScope = WarehouseScopeAwareRequest & { scope?: UserScope };

export interface DecodedScopeClaims {
  userId: string;
  tenantId: string;
  permissions: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F1-SCOPE-03: decodifica `sub`/`tenantId`/`permissions` del Bearer token SIN
 * verificar firma — mismo patrón que `resolveTenantId` (F1-TENANT-01) /
 * `resolveLocale` (F1-LOCALE-02): los middlewares corren ANTES que los
 * guards, así que no pueden depender de `req.user` (poblado por
 * `JwtAuthGuard`).
 *
 * A diferencia de tenantId/locale (solo observabilidad/UX), acá el resultado
 * SÍ alimenta una decisión de negocio (`req.scope`). Es seguro igual porque
 * `req.scope` únicamente se LEE en `@CurrentUserScope()` (F1-SCOPE-04), un
 * param decorator que Nest resuelve al invocar el handler — es decir,
 * DESPUÉS de que `JwtAuthGuard` ya validó la firma real. Un token forjado
 * nunca supera el guard, así que el valor calculado acá con datos forjados
 * jamás llega a ejecutarse.
 */
export function decodeUnverifiedScopeClaims(
  req: WarehouseScopeAwareRequest,
): DecodedScopeClaims | undefined {
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
    const payload = JSON.parse(payloadJson) as {
      sub?: unknown;
      tenantId?: unknown;
      permissions?: unknown;
    };

    if (!isUuid(payload.sub) || !isUuid(payload.tenantId) || !isStringArray(payload.permissions)) {
      return undefined;
    }

    return { userId: payload.sub, tenantId: payload.tenantId, permissions: payload.permissions };
  } catch {
    return undefined;
  }
}

/**
 * Lee `req.scope` (seteado por `WarehouseScopeMiddleware`); si no corrió (o
 * el request no traía un Bearer token válido), degrada fail-closed a
 * `{ warehouseIds: [] }` en vez de `undefined` — los handlers no necesitan
 * null-check.
 */
export function getScope(req: { scope?: UserScope }): UserScope {
  return req.scope ?? { warehouseIds: [] };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
