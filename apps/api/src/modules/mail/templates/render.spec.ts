import type { I18nService } from "nestjs-i18n";
import { COMMERCIAL_MAIL_TEMPLATES, isCommercialTemplate } from "../mailer.port";
import { renderMailTemplate } from "./render";
import { SENDER_ADDRESS, SENDER_LEGAL_NAME } from "./sender-identity";

function fakeI18n(): I18nService {
  const dict: Record<string, string> = {
    "emails.verifyEmail.subject": "Verifica tu cuenta de SellPointy",
    "emails.verifyEmail.greeting": "Hola {firstName},",
    "emails.verifyEmail.body": "Confirma tu correo.",
    "emails.verifyEmail.cta": "Verificar correo",
    "emails.verifyEmail.expiry": "Vence en 24 horas.",
    "emails.linkFallback": "Si el botón no funciona, copia y pega este enlace en tu navegador:",
    "emails.commercialFooter.sender": "Te escribe {legalName}, con domicilio en {address}.",
    "emails.commercialFooter.unsubscribe":
      "Si no quieres recibir más correos comerciales nuestros, date de baja aquí:",
  };

  return {
    translate: jest.fn((key: string, options?: { args?: Record<string, string> }) => {
      const template = dict[key] ?? key;
      return template.replace(/\{(\w+)\}/g, (_, name) => options?.args?.[name] ?? "");
    }),
  } as unknown as I18nService;
}

const LINK = "https://app.example.com/verify-email?token=abc123";

function render(vars: Record<string, string> = { firstName: "Ana", link: LINK }) {
  return renderMailTemplate(fakeI18n(), "verify-email", vars, "es");
}

/**
 * El correo con BOTÓN (Carlos, 2026-08-25): antes se mandaba solo texto
 * plano y el CTA quedaba como una palabra suelta bajo el link. Ahora viajan
 * las dos versiones — HTML con botón azul de marca + el enlace copiable como
 * alternativa, y el texto plano de siempre como fallback del cliente de
 * correo.
 */
describe("renderMailTemplate", () => {
  it("el HTML trae el CTA como BOTÓN azul de marca apuntando al link", () => {
    const { html } = render();

    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain("#2456e5");
    expect(html).toContain("Verificar correo");
  });

  it("el enlace también va como TEXTO copiable, con su explicación", () => {
    const { html } = render();

    // Dos apariciones del link: el href del botón y el texto copiable.
    expect(html.split(LINK).length - 1).toBeGreaterThanOrEqual(2);
    expect(html).toContain("copia y pega");
  });

  it("el texto plano de siempre no cambia: es el fallback del cliente", () => {
    const { text } = render();

    expect(text).toContain("Hola Ana,");
    expect(text).toContain(LINK);
    expect(text).toContain("Vence en 24 horas.");
  });

  /**
   * `firstName` lo escribe el usuario al registrarse: sin escape, un nombre
   * con HTML viviría dentro del correo como markup real.
   */
  it("un firstName con HTML se ESCAPA, no se interpreta", () => {
    const { html } = render({ firstName: `<script>alert("x")</script>`, link: LINK });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  /**
   * F11-SITE-LEAD-05: la respuesta automática al prospecto va en SU idioma, y
   * el sitio habla tres — el francés incluido, que la aplicación todavía no
   * habla. El tipo de locale se ensanchó solo para eso; las plantillas de
   * siempre siguen siendo es/en.
   */
  it("una plantilla del sitio se puede renderizar en francés", () => {
    const i18n = fakeI18n();
    // F11-SITE-LEGAL-04: `site-lead-reply` es COMERCIAL, así que desde ahora
    // exige su enlace de baja para poder renderizarse.
    renderMailTemplate(
      i18n,
      "site-lead-reply",
      {
        name: "Ana",
        link: LINK,
        unsubscribeUrl: "https://app.example.com/api/public/unsubscribe?token=x",
      },
      "fr",
    );

    expect(i18n.translate).toHaveBeenCalledWith(
      "emails.siteLeadReply.subject",
      expect.objectContaining({ lang: "fr" }),
    );
  });

  it("el aviso al backoffice de un prospecto tiene su propia clave", () => {
    const i18n = fakeI18n();
    renderMailTemplate(i18n, "site-lead", { name: "Ana" }, "es");

    expect(i18n.translate).toHaveBeenCalledWith(
      "emails.siteLead.subject",
      expect.objectContaining({ lang: "es" }),
    );
  });
});

/**
 * F11-SITE-LEGAL-04 — el pie de los correos COMERCIALES.
 *
 * ── Por qué la lista es cerrada y el bucle recorre la lista ──────────────
 * La ley no pide un pie en cualquier correo: pide identificar a quien envía y
 * ofrecer la baja en los correos de PROMOCIÓN. Un aviso de que tu plan vence
 * no lleva baja —nadie puede darse de baja de eso— y ensuciarlo con un pie
 * legal sería peor, no mejor.
 *
 * Por eso `COMMERCIAL_MAIL_TEMPLATES` es una tupla `as const` y estos casos
 * la RECORREN en vez de nombrar `site-lead-reply` a mano: el día que alguien
 * agregue una plantilla comercial nueva, queda cubierta sin escribir un test,
 * y si la manda sin su pie, falla acá.
 */
const UNSUBSCRIBE_URL = "https://app.example.com/api/public/unsubscribe?token=abc.def";

describe("El pie de los correos comerciales (F11-SITE-LEGAL-04)", () => {
  it("la lista de comerciales es cerrada y hoy tiene UNA sola plantilla", () => {
    expect([...COMMERCIAL_MAIL_TEMPLATES]).toEqual(["site-lead-reply"]);
  });

  it("los transaccionales NO son comerciales: no llevan baja ni pie", () => {
    expect(isCommercialTemplate("verify-email")).toBe(false);
    expect(isCommercialTemplate("payment-past-due")).toBe(false);
    // El aviso INTERNO de un prospecto lo lee el backoffice, no el prospecto.
    expect(isCommercialTemplate("site-lead")).toBe(false);
  });

  it.each(COMMERCIAL_MAIL_TEMPLATES)(
    "«%s» NO se puede renderizar sin su enlace de baja",
    (template) => {
      expect(() =>
        renderMailTemplate(fakeI18n(), template, { name: "Ana", link: LINK }, "es"),
      ).toThrow(/unsubscribeUrl/);
    },
  );

  it.each(COMMERCIAL_MAIL_TEMPLATES)(
    "«%s» lleva quién envía y cómo darse de baja, en texto y en HTML",
    (template) => {
      const { text, html } = renderMailTemplate(
        fakeI18n(),
        template,
        { name: "Ana", link: LINK, unsubscribeUrl: UNSUBSCRIBE_URL },
        "es",
      );

      for (const contenido of [text, html]) {
        expect(contenido).toContain(SENDER_LEGAL_NAME);
        expect(contenido).toContain(SENDER_ADDRESS);
        expect(contenido).toContain(UNSUBSCRIBE_URL);
      }
      // En el HTML, la baja es un enlace de verdad: nadie copia y pega una
      // URL de 120 caracteres para dejar de recibir correos.
      expect(html).toContain(`href="${UNSUBSCRIBE_URL}"`);
    },
  );

  it("un transaccional NO gana el pie aunque le pasen el enlace de baja", () => {
    const { text, html } = renderMailTemplate(
      fakeI18n(),
      "verify-email",
      { firstName: "Ana", link: LINK, unsubscribeUrl: UNSUBSCRIBE_URL },
      "es",
    );

    expect(text).not.toContain(UNSUBSCRIBE_URL);
    expect(html).not.toContain(SENDER_LEGAL_NAME);
  });
});
