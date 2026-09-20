import { describe, expect, it } from "vitest";
import { ANCHORS, APP_REGISTER_URL, appUrl, CONTACT_EMAIL } from "../src/config/links";
import { getLocale, MARKETS, ROUTES, type Route } from "../src/config/markets";
import { getMessages } from "../src/i18n";
import { referrerDomain } from "../src/lead/track";
import { readDist } from "./dist";

// F11-SITE-LEAD-07 — el formulario de interés, leído del sitio construido.

function formOf(route: Route): string {
  const html = readDist(`${route}/index.html`);
  const start = html.indexOf('id="contact-form"');
  expect(start, "no existe el formulario").toBeGreaterThan(0);
  return html.slice(start, html.indexOf("</section>", start));
}
const tag = (markup: string, pattern: RegExp) => markup.match(pattern)?.[0] ?? "";

describe("formulario de interés", () => {
  it.each([...ROUTES])("/%s/ vive dentro de #contact, y «Escríbenos» lleva a él", (route) => {
    const html = readDist(`${route}/index.html`);
    const contact = html.search(new RegExp(`<section\\b[^>]*\\bid="${ANCHORS.contact}"`));
    expect(html.indexOf('id="contact-form"')).toBeGreaterThan(contact);
    expect(html).toContain('href="#contact-form"');
  });

  it.each([...ROUTES])("/%s/: toda etiqueta es VISIBLE y está atada a su campo", (route) => {
    const form = formOf(route);
    const ids = [...form.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([\w-]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const id of ids) expect(form, id).toMatch(new RegExp(`<label\\b[^>]*for="${id}"`));
    // Un `placeholder` no es una etiqueta: desaparece justo cuando hace falta.
    expect(form).not.toMatch(/\bplaceholder=/);
  });

  it.each([...ROUTES])("/%s/: nombre y correo se autocompletan, y no se pide teléfono", (route) => {
    const form = formOf(route);
    expect(tag(form, /<input\b[^>]*name="name"[^>]*>/)).toContain('autocomplete="name"');
    const email = tag(form, /<input\b[^>]*name="email"[^>]*>/);
    expect(email).toContain('type="email"');
    expect(email).toContain('autocomplete="email"');
    expect(form).not.toMatch(/type="tel"|name="phone"/);
  });

  it.each([...ROUTES])("/%s/: el país llega elegido según el mercado", (route) => {
    const { country } = MARKETS[getLocale(route).market];
    const select = tag(formOf(route), /<select\b[^>]*name="country"[\s\S]*?<\/select>/);
    const selected = [...select.matchAll(/<option\b([^>]*)>/g)].filter((m) =>
      /\bselected\b/.test(m[1] as string),
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.[1]).toContain(`value="${country}"`);
  });

  it.each([...ROUTES])(
    "/%s/: cinco planes, y sin botón de tarjeta abre en «Todavía no sé»",
    (route) => {
      const select = tag(formOf(route), /<select\b[^>]*name="plan"[\s\S]*?<\/select>/);
      const options = [...select.matchAll(/<option\b([^>]*)>/g)].map((m) => m[1] as string);
      expect(options.map((o) => o.match(/value="(\w+)"/)?.[1])).toEqual([
        "basic",
        "pro",
        "plus",
        "custom",
        "undecided",
      ]);
      expect(options.filter((o) => /\bselected\b/.test(o))).toHaveLength(1);
      expect(options.find((o) => /\bselected\b/.test(o))).toContain('value="undecided"');
    },
  );

  it.each([...ROUTES])(
    "/%s/: el consentimiento NUNCA llega marcado (lo exige la ley canadiense)",
    (route) => {
      const consent = tag(formOf(route), /<input\b[^>]*name="consent"[^>]*>/);
      expect(consent).toContain('type="checkbox"');
      expect(consent).not.toMatch(/\bchecked\b/);
      expect(formOf(route)).toContain(getMessages(route).leadForm.consent.replace(/'/g, "&#39;"));
    },
  );

  it.each([...ROUTES])("/%s/: el botón ENVÍA el formulario (type=submit)", (route) => {
    // Cazado en el navegador: `Button` fijaba `type="button"` y el formulario
    // no se enviaba nunca, con todas las demás pruebas en verde.
    const button = tag(formOf(route), /<button\b[^>]*data-submit[^>]*>/);
    expect(button).toContain('type="submit"');
    expect(button).not.toContain('type="button"');
  });

  it("la trampa existe, pero ni el teclado ni el lector de pantalla llegan a ella", () => {
    const form = formOf("es-mx");
    const trap = form.match(/<div\b[^>]*class="trap[^"]*"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(trap).toContain('aria-hidden="true"');
    expect(tag(trap, /<input\b[^>]*name="website"[^>]*>/)).toContain('tabindex="-1"');
  });

  it("el éxito espera escondido, ofrece la prueba gratis y el guion lleva los textos", () => {
    const form = formOf("fr-ca");
    const success = form.slice(form.indexOf("data-lead-success"));
    expect(tag(form, /<div\b[^>]*data-lead-success[^>]*>/)).toMatch(/\bhidden\b/);
    expect(success).toContain(`href="${appUrl(APP_REGISTER_URL, "fr-ca")}"`);
    const { leadForm } = getMessages("fr-ca");
    expect(form).toContain(`data-text-sending="${leadForm.sending}"`);
  });

  it.each([...ROUTES])(
    "/%s/: si el envío falla, el error ofrece el correo como salida",
    (route) => {
      // Esperaba a que existiera un correo del dominio (2026-09-19). Quien no pudo
      // enviar el formulario no puede quedarse sin forma de escribir.
      const form = formOf(route);
      const error = form.match(/data-text-error="([^"]*)"/)?.[1] ?? "";
      expect(error).toContain(CONTACT_EMAIL);
      expect(error).not.toContain("{email}");
    },
  );

  it.each([...ROUTES])("/%s/: el pie trae el correo de contacto, como enlace", (route) => {
    const html = readDist(`${route}/index.html`);
    const footer = html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>"));
    expect(footer).toContain(`href="mailto:${CONTACT_EMAIL}"`);
  });

  it("los giros del formulario son los de la sección «Para quién», más «Otro»", () => {
    const select = tag(formOf("es-mx"), /<select\b[^>]*name="businessType"[\s\S]*?<\/select>/);
    expect(select).toContain("Papelerías");
    expect(select).toContain("Consultorios");
    expect(select).toContain(getMessages("es-mx").leadForm.businessTypeOther);
    expect(
      tag(formOf("en-ca"), /<select\b[^>]*name="businessType"[\s\S]*?<\/select>/),
    ).not.toContain("Medical");
  });
});

describe("medición: el dominio de origen", () => {
  it("se queda con el dominio, NUNCA con la URL", () => {
    expect(referrerDomain("https://www.google.com/search?q=punto+de+venta", "sellpointy.com")).toBe(
      "google.com",
    );
    expect(referrerDomain("https://l.facebook.com/l.php?u=x", "sellpointy.com")).toBe(
      "l.facebook.com",
    );
  });

  it("una visita que viene del propio sitio, o de ningún lado, no tiene origen", () => {
    expect(referrerDomain("https://sellpointy.com/es-mx/", "sellpointy.com")).toBeUndefined();
    expect(referrerDomain("https://www.sellpointy.com/", "sellpointy.com")).toBeUndefined();
    expect(referrerDomain("", "sellpointy.com")).toBeUndefined();
    expect(referrerDomain("no es una url", "sellpointy.com")).toBeUndefined();
  });
});
