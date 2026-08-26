import type { I18nService } from "nestjs-i18n";
import { renderMailTemplate } from "./render";

function fakeI18n(): I18nService {
  const dict: Record<string, string> = {
    "emails.verifyEmail.subject": "Verifica tu cuenta de SellPointy",
    "emails.verifyEmail.greeting": "Hola {firstName},",
    "emails.verifyEmail.body": "Confirma tu correo.",
    "emails.verifyEmail.cta": "Verificar correo",
    "emails.verifyEmail.expiry": "Vence en 24 horas.",
    "emails.linkFallback": "Si el botón no funciona, copia y pega este enlace en tu navegador:",
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
});
