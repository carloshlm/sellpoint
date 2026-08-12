import { getLocale, resolveLocale } from "./request-locale";

function base64urlPayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function bearerWithLocale(locale: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = base64urlPayload({ locale });
  return `Bearer ${header}.${payload}.signature-no-importa`;
}

describe("resolveLocale (F1-LOCALE-02: cascada user.locale -> Accept-Language -> default)", () => {
  it("rama 1: token Bearer con claim locale soportado -> usa esa locale", () => {
    const req = { headers: { authorization: bearerWithLocale("en"), "accept-language": "es" } };

    expect(resolveLocale(req)).toBe("en");
  });

  it("rama 1: ignora un claim locale no soportado en el token y cae a la siguiente rama", () => {
    const req = { headers: { authorization: bearerWithLocale("fr"), "accept-language": "en" } };

    expect(resolveLocale(req)).toBe("en");
  });

  it("rama 1: token malformado (no 3 segmentos) no rompe, cae a la siguiente rama", () => {
    const req = { headers: { authorization: "Bearer token-malformado", "accept-language": "en" } };

    expect(resolveLocale(req)).toBe("en");
  });

  it("rama 1: payload no es JSON válido, cae a la siguiente rama sin lanzar", () => {
    const header = Buffer.from("{}").toString("base64url");
    const req = {
      headers: {
        authorization: `Bearer ${header}.no-es-json-valido.firma`,
        "accept-language": "es",
      },
    };

    expect(resolveLocale(req)).toBe("es");
  });

  it("rama 1: sin header Authorization, cae a la siguiente rama", () => {
    const req = { headers: { "accept-language": "en" } };

    expect(resolveLocale(req)).toBe("en");
  });

  it("rama 2: Accept-Language soportado sin token -> usa esa locale", () => {
    const req = { headers: { "accept-language": "en-US,en;q=0.9" } };

    expect(resolveLocale(req)).toBe("en");
  });

  it("rama 2: respeta el q-value más alto entre varios idiomas", () => {
    const req = { headers: { "accept-language": "fr;q=0.9,en;q=0.5" } };

    expect(resolveLocale(req)).toBe("en");
  });

  it("rama 3: Accept-Language no soportado -> DEFAULT_LOCALE", () => {
    const req = { headers: { "accept-language": "fr-FR" } };

    expect(resolveLocale(req)).toBe("es");
  });

  it("rama 3: sin ningún header -> DEFAULT_LOCALE", () => {
    const req = { headers: {} };

    expect(resolveLocale(req)).toBe("es");
  });
});

describe("getLocale (helper)", () => {
  it("devuelve req.locale si ya fue seteado", () => {
    expect(getLocale({ locale: "en" })).toBe("en");
  });

  it("devuelve DEFAULT_LOCALE si req.locale no fue seteado", () => {
    expect(getLocale({})).toBe("es");
  });
});
