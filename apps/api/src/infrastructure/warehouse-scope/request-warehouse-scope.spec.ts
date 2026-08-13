import { decodeUnverifiedScopeClaims, getScope } from "./request-warehouse-scope";

function bearerWithClaims(
  claims: Partial<{ sub: unknown; tenantId: unknown; permissions: unknown }>,
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `Bearer ${header}.${payload}.firma-no-importa`;
}

describe("decodeUnverifiedScopeClaims (F1-SCOPE-03)", () => {
  const userId = "8b7e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6b";
  const tenantId = "2c9e6f2a-1c3d-4e5f-9a0b-1c2d3e4f5a6c";

  it("decodifica sub/tenantId/permissions de un Bearer token bien formado", () => {
    const req = {
      headers: {
        authorization: bearerWithClaims({ sub: userId, tenantId, permissions: ["pos:sell"] }),
      },
    };

    expect(decodeUnverifiedScopeClaims(req)).toEqual({
      userId,
      tenantId,
      permissions: ["pos:sell"],
    });
  });

  it("sin header Authorization -> undefined", () => {
    expect(decodeUnverifiedScopeClaims({ headers: {} })).toBeUndefined();
  });

  it("header sin prefijo Bearer -> undefined", () => {
    expect(
      decodeUnverifiedScopeClaims({ headers: { authorization: "Token abc" } }),
    ).toBeUndefined();
  });

  it("token con menos de 3 segmentos -> undefined", () => {
    expect(
      decodeUnverifiedScopeClaims({ headers: { authorization: "Bearer solo-un-segmento" } }),
    ).toBeUndefined();
  });

  it("payload no es JSON válido -> undefined (no lanza)", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const req = { headers: { authorization: `Bearer ${header}.no-es-json-base64url.firma` } };

    expect(decodeUnverifiedScopeClaims(req)).toBeUndefined();
  });

  it("sub con formato no-UUID -> undefined", () => {
    const req = {
      headers: {
        authorization: bearerWithClaims({ sub: "no-es-un-uuid", tenantId, permissions: [] }),
      },
    };

    expect(decodeUnverifiedScopeClaims(req)).toBeUndefined();
  });

  it("tenantId ausente -> undefined", () => {
    const req = { headers: { authorization: bearerWithClaims({ sub: userId, permissions: [] }) } };

    expect(decodeUnverifiedScopeClaims(req)).toBeUndefined();
  });

  it("permissions no es array de strings -> undefined", () => {
    const req = {
      headers: {
        authorization: bearerWithClaims({ sub: userId, tenantId, permissions: "no-es-array" }),
      },
    };

    expect(decodeUnverifiedScopeClaims(req)).toBeUndefined();
  });
});

describe("getScope (F1-SCOPE-04)", () => {
  it("devuelve req.scope cuando el middleware ya corrió", () => {
    const scope = { warehouseIds: ["w1"] };
    expect(getScope({ scope })).toBe(scope);
  });

  it("sin req.scope -> fail-closed a warehouseIds: []", () => {
    expect(getScope({})).toEqual({ warehouseIds: [] });
  });
});
