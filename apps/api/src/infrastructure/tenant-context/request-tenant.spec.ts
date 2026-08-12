import { resolveTenantId } from "./request-tenant";

function bearerWithTenant(tenantId: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ tenantId })).toString("base64url");
  return `Bearer ${header}.${payload}.firma-no-importa`;
}

describe("resolveTenantId (F1-TENANT-01)", () => {
  const validTenantId = "8b7e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6b";

  it("decodifica el claim tenantId de un Bearer token bien formado", () => {
    const req = { headers: { authorization: bearerWithTenant(validTenantId) } };

    expect(resolveTenantId(req)).toBe(validTenantId);
  });

  it("sin header Authorization -> undefined", () => {
    expect(resolveTenantId({ headers: {} })).toBeUndefined();
  });

  it("header sin prefijo Bearer -> undefined", () => {
    expect(resolveTenantId({ headers: { authorization: "Token abc" } })).toBeUndefined();
  });

  it("token con menos de 3 segmentos -> undefined", () => {
    expect(
      resolveTenantId({ headers: { authorization: "Bearer solo-un-segmento" } }),
    ).toBeUndefined();
  });

  it("payload no es JSON válido -> undefined (no lanza)", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const req = { headers: { authorization: `Bearer ${header}.no-es-json-base64url.firma` } };

    expect(resolveTenantId(req)).toBeUndefined();
  });

  it("claim tenantId ausente -> undefined", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url");
    const req = { headers: { authorization: `Bearer ${header}.${payload}.firma` } };

    expect(resolveTenantId(req)).toBeUndefined();
  });

  it("claim tenantId con formato no-UUID -> undefined (evita loguear basura)", () => {
    expect(
      resolveTenantId({ headers: { authorization: bearerWithTenant("no-es-un-uuid") } }),
    ).toBeUndefined();
  });
});
