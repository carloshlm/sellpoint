import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import type { Env } from "../../config/env.schema";
import { ConsoleMailer } from "./console.mailer";
import { MAILER, type MailerPort } from "./mailer.port";
import { NoopMailer } from "./noop.mailer";
import { ResendMailer } from "./resend.mailer";

// f1-auth AD-9: MAIL_DRIVER=console|resend|noop resuelto por factory. El
// gate de "console/noop prohibido en production" ya vive en env.schema.ts
// (fail-closed al bootear, cubierto por env.schema.spec.ts) — acá solo se
// elige la implementación. Función pura separada del provider de Nest para
// poder testearla sin levantar el módulo completo.
export function createMailer(
  configService: ConfigService<Env, true>,
  i18n: I18nService,
): MailerPort {
  const driver = configService.get("MAIL_DRIVER", { infer: true });

  switch (driver) {
    case "resend":
      return new ResendMailer(i18n, configService);
    case "noop":
      return new NoopMailer();
    default:
      return new ConsoleMailer(i18n);
  }
}

// ConfigModule (isGlobal) e I18nModule (global desde AppModule, ver
// app.module.ts) ya exponen ConfigService/I18nService en todo el árbol de
// DI — no hace falta reimportarlos acá.
@Module({
  providers: [
    {
      provide: MAILER,
      useFactory: createMailer,
      inject: [ConfigService, I18nService],
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
