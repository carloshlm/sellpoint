import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isSiteLeadSpam, type SiteLeadInput } from "@sellpoint/shared";
import * as Sentry from "@sentry/node";
import { platformAdminEmails } from "../../common/config/platform-admin-emails";
import type { Env } from "../../config/env.schema";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { MAILER, type MailerPort } from "../mail/mailer.port";
// Importación de VALOR: Nest resuelve la dependencia por el metadato de diseño
// del constructor, que un `import type` borraría.
import { SiteUnsubscribeService } from "./site-unsubscribe.service";

/**
 * A dónde lleva el botón de la respuesta automática. Es la aplicación, no el
 * sitio: quien ya nos escribió puede empezar la prueba sin esperarnos.
 */
const REGISTER_URL = "https://app.sellpointy.com/register";

/**
 * La respuesta del endpoint público, SIEMPRE la misma. Es un tipo exportado a
 * propósito: un método público de un servicio Nest que devuelve un tipo
 * anónimo rompe `nest build` (TS4053).
 */
export interface SiteLeadAccepted {
  received: true;
}

/**
 * F11-SITE-LEAD — quien nos escribió desde `sellpointy.com`.
 *
 * ── La regla del 202 ────────────────────────────────────────────────────
 * Este servicio responde SIEMPRE `{ received: true }`. Da igual si el correo
 * ya escribió antes (si no, el endpoint serviría para averiguar quién nos
 * escribió), si cayó en la trampa o si el correo de aviso rebotó. Lo único
 * que responde distinto es un cuerpo MAL FORMADO, y eso lo decide el pipe de
 * zod antes de llegar acá: el formulario real necesita saber qué corregir.
 *
 * ── Guardar primero, avisar después ─────────────────────────────────────
 * El orden no es casual. Si el aviso saliera primero y la base fallara,
 * tendríamos un correo sobre un prospecto que no existe; al revés, un Resend
 * caído deja la fila con `notified_at` en NULL y el backoffice la muestra
 * como «sin avisar» — la red para el día que un correo no llegue.
 *
 * ── Contra el spam, sin captcha ─────────────────────────────────────────
 * Un captcha le cuesta conversiones a gente real para frenar un problema que
 * todavía no existe. Hoy: la trampa, el reloj (`isSiteLeadSpam`, en `shared`)
 * y el límite por IP (`SiteThrottlerGuard`). Lo atrapado se descarta en
 * silencio — decirle al robot qué falló es enseñarle a corregirlo.
 */
@Injectable()
export class SiteLeadsService {
  private readonly logger = new Logger(SiteLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: MailerPort,
    private readonly configService: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly unsubscribes: SiteUnsubscribeService,
  ) {}

  async submit(input: SiteLeadInput): Promise<SiteLeadAccepted> {
    if (isSiteLeadSpam(input)) {
      // SIN datos personales: un log de descartes con correos dentro sería
      // una libreta de prospectos en texto plano. Solo cuál señal saltó.
      const motivo = input.website ? "honeypot" : "too_fast";
      this.logger.log(`Prospecto del sitio descartado (${motivo})`);
      return { received: true };
    }

    const ahora = this.clock.now();
    const lead = await this.prisma.siteLead.create({
      data: {
        name: input.name,
        email: input.email,
        country: input.country,
        locale: input.locale,
        route: input.route,
        planInterest: input.planInterest,
        businessType: input.businessType,
        message: input.message,
        sourceUrl: input.sourceUrl,
        consentAt: ahora,
        consentText: input.consentText,
      },
    });

    await this.notifyPlatform(lead.id, input, ahora);
    await this.replyToLead(lead.id, input);

    return { received: true };
  }

  /**
   * El aviso al backoffice, en ESPAÑOL: es el idioma de quien lo lee, no el
   * del prospecto. Con `Reply-To` al correo del prospecto, para contestarle
   * con un clic en vez de copiar la dirección a mano.
   */
  private async notifyPlatform(leadId: string, input: SiteLeadInput, ahora: Date): Promise<void> {
    const admins = platformAdminEmails(this.configService);
    if (admins.length === 0) {
      // Sin sellar `notified_at`: nadie se enteró, y la lista del backoffice
      // tiene que poder decirlo.
      this.logger.warn("Prospecto del sitio sin destinatario: BILLING_ADMIN_EMAILS está vacío");
      return;
    }

    // Los vacíos se mandan como cadena vacía y no como «undefined»: lo que
    // viaja al correo es texto, y un «undefined» impreso en el aviso es peor
    // que un renglón en blanco.
    const vars = {
      name: input.name,
      email: input.email,
      country: input.country,
      planInterest: input.planInterest,
      businessType: input.businessType ?? "—",
      message: input.message ?? "—",
      route: input.route,
      sourceUrl: input.sourceUrl ?? "—",
    };

    try {
      await Promise.all(
        admins.map((to) =>
          this.mailer.send({
            to,
            template: "site-lead",
            locale: "es",
            vars,
            replyTo: input.email,
          }),
        ),
      );
      await this.prisma.siteLead.update({
        where: { id: leadId },
        data: { notifiedAt: ahora },
      });
    } catch (error) {
      // El prospecto YA está guardado: esto no revierte nada y no cambia la
      // respuesta. Va a Sentry porque es un fallo NUESTRO que hay que ver.
      this.logger.error(
        `Fallo al avisar un prospecto del sitio (${leadId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      Sentry.captureException(error);
    }
  }

  /**
   * F11-SITE-LEAD-05 — el acuse al prospecto, en SU idioma (es, en o fr).
   *
   * Es el ÚNICO correo comercial que existe hoy (`COMMERCIAL_MAIL_TEMPLATES`),
   * y por eso es el único que lleva pie con enlace de baja — que el renderi-
   * zador exige: sin `unsubscribeUrl` esta plantilla ni se renderiza.
   *
   * La condición del consentimiento va EXPLÍCITA aunque el schema ya lo exija:
   * escribirle a alguien que no dijo que sí es justo lo que el aviso de
   * privacidad promete que no hacemos, y esa promesa no puede depender de que
   * nadie relaje la validación algún día.
   */
  private async replyToLead(leadId: string, input: SiteLeadInput): Promise<void> {
    if (input.consent !== true) {
      return;
    }

    // F11-SITE-LEGAL-04: quien ya se dio de baja no vuelve a recibir un
    // comercial, aunque hoy nos escriba de nuevo. Se mira por CORREO y no por
    // fila: el prospecto que escribe dos veces es la misma persona, y la
    // segunda fila no borra el «no me escriban» de la primera.
    if (await this.hasUnsubscribed(input.email)) {
      this.logger.log("Acuse omitido: el prospecto se dio de baja de los correos comerciales");
      return;
    }

    try {
      await this.mailer.send({
        to: input.email,
        template: "site-lead-reply",
        locale: input.locale,
        vars: {
          name: input.name,
          email: input.email,
          link: REGISTER_URL,
          unsubscribeUrl: this.unsubscribes.urlFor(leadId, input.locale),
        },
      });
    } catch (error) {
      // Un acuse que rebota es molesto, no grave: el prospecto está guardado y
      // el aviso al backoffice ya salió. No va a Sentry ni cambia el 202.
      this.logger.warn(
        `Fallo al enviar el acuse de un prospecto del sitio: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** ¿Este correo pidió alguna vez dejar de recibir correos comerciales? */
  private async hasUnsubscribed(email: string): Promise<boolean> {
    const baja = await this.prisma.siteLead.findFirst({
      where: { email, unsubscribedAt: { not: null } },
      select: { id: true },
    });
    return baja !== null;
  }
}
