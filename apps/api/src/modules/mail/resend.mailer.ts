import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { I18nService } from "nestjs-i18n";
import type { Env } from "../../config/env.schema";
import type { MailerPort, MailMessage } from "./mailer.port";
import { renderMailTemplate } from "./templates/render";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * f1-auth AD-9: fetch nativo de Node 22, sin SDK (son ~20 líneas y el SDK
 * arrastra dependencias en una imagen con mem_limit: 512M).
 *
 * Regla dura (batch U2, incidente de dominio sin SPF/DKIM verificar en
 * Resend): un fallo del proveedor JAMÁS rompe el request que lo dispara.
 * `send()` nunca rechaza — cualquier error de red o respuesta no-ok se
 * loguea como ERROR y se resuelve igual. El envío es best-effort en F1; la
 * cola con reintentos es F6.
 */
@Injectable()
export class ResendMailer implements MailerPort {
  private readonly logger = new Logger(ResendMailer.name);

  constructor(
    private readonly i18n: I18nService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const { subject, text } = renderMailTemplate(
      this.i18n,
      message.template,
      message.vars,
      message.locale,
    );
    const from = this.configService.get("MAIL_FROM", { infer: true });
    const apiKey = this.configService.get("RESEND_API_KEY", { infer: true });

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [message.to], subject, text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        this.logger.error(
          `Resend respondió ${response.status} al enviar a ${message.to}: ${detail}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Fallo al enviar mail vía Resend a ${message.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
