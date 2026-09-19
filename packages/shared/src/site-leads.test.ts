import { describe, expect, it } from "vitest";
import {
  isSiteLeadSpam,
  SITE_LEAD_LIMITS,
  SITE_LEAD_MIN_ELAPSED_MS,
  SITE_PLAN_INTERESTS,
  siteLeadSchema,
  siteLeadsQuerySchema,
} from "./site-leads";

/**
 * F11-SITE-LEAD-02/03 — el contrato del formulario del sitio público, en
 * código compartido: el sitio valida con él antes de enviar y el API lo
 * vuelve a validar al recibir. Una sola verdad para los largos, las listas
 * cerradas y el consentimiento.
 */

/** Un cuerpo válido mínimo, para que cada caso cambie SOLO lo que prueba. */
function cuerpo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Ana Pérez",
    email: "ana@example.com",
    country: "MX",
    locale: "es",
    route: "es-mx",
    planInterest: "pro",
    consent: true,
    consentText: "Acepto el aviso de privacidad.",
    ...overrides,
  };
}

describe("siteLeadSchema (F11-SITE-LEAD-02)", () => {
  it("acepta el cuerpo mínimo y normaliza correo y país", () => {
    const resultado = siteLeadSchema.safeParse(
      cuerpo({ email: "  Ana@Example.COM ", country: "mx" }),
    );

    expect(resultado.success).toBe(true);
    expect(resultado.data?.email).toBe("ana@example.com");
    expect(resultado.data?.country).toBe("MX");
  });

  it("los cinco planes de interés son lista cerrada", () => {
    expect([...SITE_PLAN_INTERESTS]).toEqual(["basic", "pro", "plus", "custom", "undecided"]);
    expect(siteLeadSchema.safeParse(cuerpo({ planInterest: "enterprise" })).success).toBe(false);
  });

  it("un correo inválido no pasa", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ email: "ana@" })).success).toBe(false);
  });

  it("un país que no es ISO-2 no pasa", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ country: "XX" })).success).toBe(false);
  });

  it("acepta cualquier país ISO-2, no solo los tres mercados", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ country: "AR" })).success).toBe(true);
  });

  it("el consentimiento es OBLIGATORIO y literal: false no pasa, ausente tampoco", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ consent: false })).success).toBe(false);
    const { consent: _sin, ...resto } = cuerpo();
    expect(siteLeadSchema.safeParse(resto).success).toBe(false);
  });

  it("el texto exacto que aceptó viaja y no puede venir vacío", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ consentText: "   " })).success).toBe(false);
  });

  it.each([
    ["name", SITE_LEAD_LIMITS.name],
    ["email", SITE_LEAD_LIMITS.email],
    ["businessType", SITE_LEAD_LIMITS.businessType],
    ["message", SITE_LEAD_LIMITS.message],
    ["consentText", SITE_LEAD_LIMITS.consentText],
    ["sourceUrl", SITE_LEAD_LIMITS.sourceUrl],
  ])("%s respeta su largo máximo (%i)", (campo, max) => {
    // El correo y la URL tienen formato propio: el exceso se arma con un
    // valor que SÍ sería válido de no ser por el largo.
    const largo =
      campo === "email"
        ? `${"a".repeat(max)}@example.com`
        : campo === "sourceUrl"
          ? `https://sellpointy.com/${"a".repeat(max)}`
          : "a".repeat(max + 1);

    expect(siteLeadSchema.safeParse(cuerpo({ [campo]: largo })).success).toBe(false);
  });

  it("los campos opcionales pueden faltar, venir vacíos o venir nulos", () => {
    const resultado = siteLeadSchema.safeParse(
      cuerpo({ businessType: "", message: null, sourceUrl: undefined }),
    );

    expect(resultado.success).toBe(true);
    expect(resultado.data?.businessType).toBeNull();
    expect(resultado.data?.message).toBeNull();
    expect(resultado.data?.sourceUrl).toBeNull();
  });

  it("el idioma es es|en|fr — el francés existe en el sitio aunque no en la aplicación", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ locale: "fr" })).success).toBe(true);
    expect(siteLeadSchema.safeParse(cuerpo({ locale: "pt" })).success).toBe(false);
  });

  it("la ruta es la del sitio (`es-mx`), no un texto libre", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ route: "fr-ca" })).success).toBe(true);
    expect(siteLeadSchema.safeParse(cuerpo({ route: "no es una ruta" })).success).toBe(false);
  });

  /**
   * La trampa y el reloj NO invalidan el cuerpo: si lo hicieran, el API
   * respondería 400 y le enseñaría al robot exactamente qué corregir. El
   * cuerpo es válido, y quien decide descartarlo es `isSiteLeadSpam`.
   */
  it("la trampa llena y el envío instantáneo son cuerpos VÁLIDOS", () => {
    expect(siteLeadSchema.safeParse(cuerpo({ website: "http://spam.example" })).success).toBe(true);
    expect(siteLeadSchema.safeParse(cuerpo({ elapsedMs: 12 })).success).toBe(true);
  });
});

describe("isSiteLeadSpam (F11-SITE-LEAD-03)", () => {
  it("el mínimo de tiempo son 3 segundos", () => {
    expect(SITE_LEAD_MIN_ELAPSED_MS).toBe(3_000);
  });

  it("un envío normal no es spam", () => {
    expect(isSiteLeadSpam({ elapsedMs: 9_000 })).toBe(false);
  });

  it("la trampa llena es spam, aunque el resto esté perfecto", () => {
    expect(isSiteLeadSpam({ website: "http://spam.example", elapsedMs: 9_000 })).toBe(true);
  });

  it("la trampa vacía o con espacios NO es spam: un autocompletado deja eso", () => {
    expect(isSiteLeadSpam({ website: "", elapsedMs: 9_000 })).toBe(false);
    expect(isSiteLeadSpam({ website: "   ", elapsedMs: 9_000 })).toBe(false);
  });

  it("enviar antes del mínimo es spam", () => {
    expect(isSiteLeadSpam({ elapsedMs: 2_999 })).toBe(true);
    expect(isSiteLeadSpam({ elapsedMs: 3_000 })).toBe(false);
  });

  /**
   * Sin `elapsedMs` NO se descarta: el reloj lo pone el JavaScript del sitio
   * y tragarse en silencio el mensaje de quien no lo ejecuta costaría
   * prospectos reales. La trampa y el límite por IP siguen cubriendo al robot.
   */
  it("sin elapsedMs no se descarta", () => {
    expect(isSiteLeadSpam({})).toBe(false);
  });
});

describe("siteLeadsQuerySchema (F11-SITE-LEAD-08)", () => {
  it("sin nada, la primera página con el tamaño por omisión", () => {
    const resultado = siteLeadsQuerySchema.safeParse({});

    expect(resultado.data).toEqual({ page: 1, pageSize: 20 });
  });

  it("page y pageSize llegan como texto desde la query string", () => {
    const resultado = siteLeadsQuerySchema.safeParse({ page: "3", pageSize: "50" });

    expect(resultado.data).toMatchObject({ page: 3, pageSize: 50 });
  });

  it("el rango se pide con días (`YYYY-MM-DD`), no con instantes", () => {
    expect(siteLeadsQuerySchema.safeParse({ from: "2026-09-01", to: "2026-09-30" }).success).toBe(
      true,
    );
    expect(siteLeadsQuerySchema.safeParse({ from: "01/09/2026" }).success).toBe(false);
  });

  it("el tamaño de página tiene techo: nadie se baja la tabla entera de un tirón", () => {
    expect(siteLeadsQuerySchema.safeParse({ pageSize: "5000" }).success).toBe(false);
  });
});
