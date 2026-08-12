import type { ExecutionContext } from "@nestjs/common";
import { RequestLocaleResolver } from "./request-locale.resolver";

function buildContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("RequestLocaleResolver (F1-LOCALE-03: custom resolver de nestjs-i18n)", () => {
  const resolver = new RequestLocaleResolver();

  it("si req.locale ya fue seteado (por LocaleResolverMiddleware), lo usa directo", () => {
    const context = buildContext({ locale: "en", headers: {} });

    expect(resolver.resolve(context)).toBe("en");
  });

  it("si req.locale NO fue seteado, recalcula la cascada desde los headers (no depende del orden de middlewares)", () => {
    const context = buildContext({ headers: { "accept-language": "en" } });

    expect(resolver.resolve(context)).toBe("en");
  });

  it("sin req.locale ni headers reconocibles, cae al DEFAULT_LOCALE", () => {
    const context = buildContext({ headers: {} });

    expect(resolver.resolve(context)).toBe("es");
  });
});
