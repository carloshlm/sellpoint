import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SITE_LANGUAGES, type SiteLanguage } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { JwtKeyProvider } from "../../infrastructure/crypto/jwt-key.provider";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Lo que devuelve un clic en el enlace de baja: si valió y qué página mostrar.
 * Tipo exportado a propósito — un método público de un servicio Nest que
 * devuelve un tipo anónimo rompe `nest build` (TS4053).
 */
export interface UnsubscribeOutcome {
  ok: boolean;
  html: string;
}

/**
 * Separador del token: `{leadId}.{locale}.{firma}`. El punto no aparece en un
 * UUID ni en base64url, así que partir por él es inequívoco.
 */
const SEPARADOR = ".";

/**
 * La etiqueta que separa este HMAC de cualquier otro uso futuro de la misma
 * llave. Sin ella, una firma de baja podría valer como firma de otra cosa.
 */
const PROPOSITO = "site-lead-unsubscribe";

/**
 * El prefijo con el que nginx publica el API bajo el MISMO dominio que la
 * aplicación (`app.sellpointy.com/api/…`, ver `infrastructure/nginx`). Se
 * deriva de `APP_URL` en vez de pedir una variable nueva porque el encargo lo
 * prohíbe, y porque una URL pública más en el `.env` es una URL más que
 * alguien puede olvidar cambiar al montar un ambiente.
 *
 * ⚠️ En DEV esto no resuelve: el API vive en `:3000` y `APP_URL` apunta a
 * Vite en `:5173`, que no proxea `/api`. El enlace del correo de dev no abre;
 * en sandbox y producción sí. Vale la pena saberlo antes de reportarlo como
 * un bug.
 */
const API_PATH_PREFIX = "/api";

/**
 * F11-SITE-LEGAL-04 — «no quiero más correos de estos».
 *
 * ── Por qué un enlace firmado y no un `mailto:` ─────────────────────────
 * Lo natural sería `mailto:bajas@sellpointy.com`, pero ese buzón todavía no
 * existe: espera al correo del dominio, que espera al DNS. Un enlace que
 * apunta a un buzón inexistente es peor que no ofrecer la baja, porque
 * aparenta cumplir.
 *
 * ── Por qué firmado ─────────────────────────────────────────────────────
 * Un `?email=…` a secas dejaría dar de baja a cualquiera escribiendo su
 * dirección, y un `?id=…` a secas, a cualquiera probando UUIDs. La firma
 * (HMAC-SHA256 derivada de la llave privada del JWT, que el env YA exige)
 * vuelve el enlace intransferible sin agregar una variable de entorno ni una
 * tabla.
 *
 * ── Por qué aplica al CORREO y no a la fila ─────────────────────────────
 * Quien escribió dos veces tiene dos filas. Dar de baja una sola dejaría al
 * siguiente correo saliendo igual, y quien pidió la baja tendría razón en
 * pensar que le mentimos.
 *
 * ── El prefetch de los escáneres ────────────────────────────────────────
 * Es un GET, así que un escáner de enlaces de Outlook o Gmail puede
 * «clicarlo» solo. Se acepta a sabiendas, al revés que en `verify-email`
 * (que por eso es POST): allá un prefetch QUEMA un token de un solo uso y
 * deja a la persona sin poder verificar su cuenta; acá lo peor que pasa es
 * que alguien deje de recibir correos comerciales que no pidió, y siempre
 * puede volver a escribirnos.
 */
@Injectable()
export class SiteUnsubscribeService {
  private readonly logger = new Logger(SiteUnsubscribeService.name);
  private readonly appUrl: string;
  /**
   * Derivado UNA vez al construir el servicio, no por petición: la llave
   * privada no cambia en caliente y un HMAC por request sería trabajo regalado.
   */
  private readonly secret: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: ClockPort,
    jwtKeys: JwtKeyProvider,
  ) {
    this.appUrl = configService.get("APP_URL", { infer: true }).replace(/\/+$/, "");
    // La llave privada del JWT exportada a DER, pasada por HMAC con el
    // propósito: el secreto que sale de acá no sirve para firmar un JWT ni
    // permite reconstruir la llave.
    const material = jwtKeys.get().privateKey.export({ type: "pkcs8", format: "der" });
    this.secret = createHmac("sha256", material).update(PROPOSITO).digest();
  }

  /** El enlace que viaja en el pie del correo comercial. */
  urlFor(leadId: string, locale: SiteLanguage | string): string {
    const payload = `${leadId}${SEPARADOR}${locale}`;
    const token = `${payload}${SEPARADOR}${this.sign(payload)}`;
    return `${this.appUrl}${API_PATH_PREFIX}/public/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  /**
   * El clic. Nunca lanza: devuelve la página y si valió, porque el que está
   * del otro lado es un navegador y un JSON de error no le sirve de nada.
   */
  async apply(token: string | undefined): Promise<UnsubscribeOutcome> {
    const verificado = this.verify(token);
    if (!verificado) {
      // SIN el token en el log: es una credencial, aunque sea de baja.
      this.logger.log("Enlace de baja inválido descartado");
      return { ok: false, html: renderPage("es", false) };
    }

    const { leadId, locale } = verificado;
    const lead = await this.prisma.siteLead.findUnique({
      where: { id: leadId },
      select: { email: true, locale: true, unsubscribedAt: true },
    });

    // La fila pudo desaparecer con el barrido de retención a los 24 meses. Se
    // confirma igual: no queda nada de qué darse de baja, y responder un error
    // sería contarle a quien clicó que su rastro ya no existe.
    if (!lead) {
      return { ok: true, html: renderPage(locale, true) };
    }

    // El idioma de la FILA gana sobre el del token: si el prospecto volvió a
    // escribir en otro idioma, ese es el que habla hoy.
    const idioma = resolveLanguage(lead.locale) ?? locale;

    if (lead.unsubscribedAt === null) {
      await this.prisma.siteLead.updateMany({
        where: { email: lead.email, unsubscribedAt: null },
        data: { unsubscribedAt: this.clock.now() },
      });
    }

    return { ok: true, html: renderPage(idioma, true) };
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private verify(token: string | undefined): { leadId: string; locale: SiteLanguage } | null {
    if (!token) {
      return null;
    }

    const partes = token.split(SEPARADOR);
    if (partes.length !== 3) {
      return null;
    }

    const [leadId, rawLocale, firma] = partes as [string, string, string];
    const locale = resolveLanguage(rawLocale);
    if (!locale) {
      return null;
    }

    const esperada = Buffer.from(this.sign(`${leadId}${SEPARADOR}${rawLocale}`), "utf8");
    const recibida = Buffer.from(firma, "utf8");
    // Comparación de tiempo constante: la longitud se chequea primero porque
    // `timingSafeEqual` lanza con buffers de distinto largo.
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
      return null;
    }

    return { leadId, locale };
  }
}

function resolveLanguage(value: string | null | undefined): SiteLanguage | null {
  return SITE_LANGUAGES.includes(value as SiteLanguage) ? (value as SiteLanguage) : null;
}

/**
 * Los textos de la página, en los TRES idiomas del sitio.
 *
 * Viven acá y no en `src/i18n/` a propósito: el `fr` del API es un directorio
 * casi vacío que existe solo por la respuesta automática al prospecto, y su
 * README pide no sembrarlo de archivos sueltos (un idioma a medias es peor que
 * ninguno). Son seis frases de una página que nadie más lee.
 *
 * El francés está redactado SIN los signos que piden espacio de no separación
 * (`:`, `!`, `?`): un carácter invisible no se puede revisar en un diff.
 */
const PAGE_TEXTS: Record<SiteLanguage, { ok: [string, string]; error: [string, string] }> = {
  es: {
    ok: ["Listo", "No te escribiremos más correos de este tipo."],
    error: [
      "El enlace no sirve",
      "Puede estar incompleto o haber caducado. Si sigues recibiendo correos nuestros, respóndele a cualquiera de ellos y lo resolvemos.",
    ],
  },
  en: {
    ok: ["Done", "We will not email you again about this."],
    error: [
      "That link did not work",
      "It may be incomplete or expired. If you keep getting emails from us, reply to any of them and we will sort it out.",
    ],
  },
  fr: {
    ok: ["C'est fait", "Nous ne vous enverrons plus de courriels de ce type."],
    error: [
      "Ce lien ne fonctionne pas",
      "Il est peut-être incomplet ou expiré. Si vous continuez de recevoir nos courriels, répondez à l'un d'eux et nous réglerons cela.",
    ],
  },
};

/**
 * Una página mínima y AUTÓNOMA: sin hojas de estilo externas, sin tipografías
 * remotas y sin JavaScript. La abre alguien que ya dijo que no quiere saber
 * más de nosotros — lo menos que puede hacer es cargar al instante y no pedirle
 * nada a nadie.
 */
function renderPage(locale: SiteLanguage, ok: boolean): string {
  const [titulo, cuerpo] = ok ? PAGE_TEXTS[locale].ok : PAGE_TEXTS[locale].error;

  return [
    "<!doctype html>",
    `<html lang="${locale}">`,
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="robots" content="noindex" />',
    `<title>${titulo} — SellPointy</title>`,
    "</head>",
    '<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f6f7f9;font-family:Helvetica,Arial,sans-serif;color:#1f2430;">',
    '<main style="max-width:420px;padding:32px;text-align:center;">',
    `<h1 style="margin:0 0 12px;font-size:20px;">${titulo}</h1>`,
    `<p style="margin:0;font-size:15px;line-height:1.6;color:#5b6472;">${cuerpo}</p>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}
