import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { I18nService } from "nestjs-i18n";
import type { Env } from "../../config/env.schema";
import { ResendMailer } from "./resend.mailer";

function fakeI18n(): I18nService {
  return {
    translate: jest.fn((key: string) => key),
  } as unknown as I18nService;
}

function fakeConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const values: Partial<Env> = {
    MAIL_FROM: "no-reply@system.laradoc.com",
    RESEND_API_KEY: "re_test_key",
    ...overrides,
  };
  return {
    get: (key: string) => values[key as keyof Env],
  } as unknown as ConfigService<Env, true>;
}

describe("ResendMailer (f1-auth AD-9, rule: nunca rompe el request)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("arma el payload con from/to/subject/text y timeout de 5s, sin SDK", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const mailer = new ResendMailer(fakeI18n(), fakeConfig());

    await mailer.send({
      to: "owner@example.com",
      template: "verify-email",
      vars: { link: "https://app.example.com/verify-email?token=abc" },
      locale: "es",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body);
    expect(body.from).toBe("no-reply@system.laradoc.com");
    expect(body.to).toEqual(["owner@example.com"]);
    expect(typeof body.subject).toBe("string");
    expect(body.text).toContain("https://app.example.com/verify-email?token=abc");
  });

  it("un fallo de red NUNCA rompe el request: loguea ERROR y resuelve igual (dominio sin SPF/DKIM verificado aún)", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const mailer = new ResendMailer(fakeI18n(), fakeConfig());

    await expect(
      mailer.send({
        to: "owner@example.com",
        template: "verify-email",
        vars: { link: "https://app.example.com/verify" },
        locale: "es",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("una respuesta no-ok (dominio no verificado, 4xx/5xx de Resend) tampoco rompe el request", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "domain not verified",
    }) as unknown as typeof fetch;

    const mailer = new ResendMailer(fakeI18n(), fakeConfig());

    await expect(
      mailer.send({
        to: "owner@example.com",
        template: "verify-email",
        vars: { link: "https://app.example.com/verify" },
        locale: "es",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
    errorSpy.mockRestore();
  });
});
