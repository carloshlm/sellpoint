import { Injectable } from "@nestjs/common";
import type { MailerPort, MailMessage } from "./mailer.port";

/**
 * Driver para tests: NO envía nada, pero CAPTURA cada mensaje enviado en
 * `sent` para que el harness e2e (f1-auth design §8) pueda leer el link/token
 * de un mail sin necesitar un servidor SMTP real —
 * `overrideProvider(MAILER).useClass(NoopMailer)`.
 */
@Injectable()
export class NoopMailer implements MailerPort {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
