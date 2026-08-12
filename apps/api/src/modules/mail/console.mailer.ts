import { Injectable, Logger } from "@nestjs/common";
import type { I18nService } from "nestjs-i18n";
import type { MailerPort, MailMessage } from "./mailer.port";
import { renderMailTemplate } from "./templates/render";

/**
 * Driver de dev (default de `MAIL_DRIVER`). Loguea el link completo — así
 * el flujo de registro/verificación es probable a mano sin bandeja real.
 * Prohibido en NODE_ENV=production (env.schema.ts, R8 del design).
 */
@Injectable()
export class ConsoleMailer implements MailerPort {
  private readonly logger = new Logger(ConsoleMailer.name);

  constructor(private readonly i18n: I18nService) {}

  async send(message: MailMessage): Promise<void> {
    const { subject, text } = renderMailTemplate(
      this.i18n,
      message.template,
      message.vars,
      message.locale,
    );

    this.logger.log(`[mail:console] to=${message.to} subject="${subject}"\n${text}`);
  }
}
