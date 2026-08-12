import { LocaleResolverMiddleware } from "./locale-resolver.middleware";

function bearerWithLocale(locale: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ locale })).toString("base64url");
  return `Bearer ${header}.${payload}.firma-no-importa`;
}

describe("LocaleResolverMiddleware (F1-LOCALE-02)", () => {
  const middleware = new LocaleResolverMiddleware();

  it("rama 1 (autenticado): setea req.locale desde el claim del token", () => {
    const req = { headers: { authorization: bearerWithLocale("en") } } as never;
    const next = jest.fn();

    middleware.use(req, {} as never, next);

    expect((req as { locale?: string }).locale).toBe("en");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rama 2 (Accept-Language): setea req.locale desde el header cuando no hay token", () => {
    const req = { headers: { "accept-language": "en-US" } } as never;
    const next = jest.fn();

    middleware.use(req, {} as never, next);

    expect((req as { locale?: string }).locale).toBe("en");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rama 3 (default): setea req.locale = 'es' sin token ni Accept-Language soportado", () => {
    const req = { headers: {} } as never;
    const next = jest.fn();

    middleware.use(req, {} as never, next);

    expect((req as { locale?: string }).locale).toBe("es");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
