import type { ConfigService } from "@nestjs/config";
import type { I18nService } from "nestjs-i18n";
import type { Env } from "../../config/env.schema";
import { ConsoleMailer } from "./console.mailer";
import { createMailer } from "./mail.module";
import { NoopMailer } from "./noop.mailer";
import { ResendMailer } from "./resend.mailer";

function fakeConfig(driver: Env["MAIL_DRIVER"]): ConfigService<Env, true> {
  return { get: () => driver } as unknown as ConfigService<Env, true>;
}

const fakeI18n = {} as I18nService;

describe("createMailer (f1-auth AD-9)", () => {
  it("MAIL_DRIVER=console → ConsoleMailer", () => {
    expect(createMailer(fakeConfig("console"), fakeI18n)).toBeInstanceOf(ConsoleMailer);
  });

  it("MAIL_DRIVER=noop → NoopMailer", () => {
    expect(createMailer(fakeConfig("noop"), fakeI18n)).toBeInstanceOf(NoopMailer);
  });

  it("MAIL_DRIVER=resend → ResendMailer", () => {
    expect(createMailer(fakeConfig("resend"), fakeI18n)).toBeInstanceOf(ResendMailer);
  });
});
