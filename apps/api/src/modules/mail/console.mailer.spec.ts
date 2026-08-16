import { Logger } from "@nestjs/common";
import type { I18nService } from "nestjs-i18n";
import { ConsoleMailer } from "./console.mailer";

function fakeI18n(): I18nService {
  const dict: Record<string, string> = {
    "emails.verifyEmail.subject": "Verifica tu cuenta de SellPoint",
    "emails.verifyEmail.greeting": "Hola {firstName},",
    "emails.verifyEmail.body": "Confirma tu correo.",
    "emails.verifyEmail.cta": "Verificar correo",
    "emails.verifyEmail.expiry": "Vence en 24 horas.",
  };

  return {
    translate: jest.fn((key: string, options?: { args?: Record<string, string> }) => {
      const template = dict[key] ?? key;
      return template.replace(/\{(\w+)\}/g, (_, name) => options?.args?.[name] ?? "");
    }),
  } as unknown as I18nService;
}

describe("ConsoleMailer", () => {
  it("loguea el link completo del mensaje (f1-auth AD-9)", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const mailer = new ConsoleMailer(fakeI18n());

    await mailer.send({
      to: "owner@example.com",
      template: "verify-email",
      vars: { firstName: "Ana", link: "https://app.example.com/verify-email?token=abc123" },
      locale: "es",
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://app.example.com/verify-email?token=abc123"),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("owner@example.com"));

    logSpy.mockRestore();
  });

  it("el subject conmuta de idioma según locale", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const i18n = fakeI18n();
    const mailer = new ConsoleMailer(i18n);

    await mailer.send({
      to: "owner@example.com",
      template: "verify-email",
      vars: { firstName: "Ana", link: "https://app.example.com/verify" },
      locale: "en",
    });

    expect(i18n.translate).toHaveBeenCalledWith(
      "emails.verifyEmail.subject",
      expect.objectContaining({ lang: "en" }),
    );

    logSpy.mockRestore();
  });
});
