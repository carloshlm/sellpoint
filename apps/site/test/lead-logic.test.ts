import { siteEventSchema, siteLeadSchema } from "@sellpoint/shared";
import { describe, expect, it } from "vitest";
import { buildLeadPayload, LEAD_PLANS, planFromSearch, validateLead } from "../src/lead/form-logic";
import { SITE_EVENTS } from "../src/lead/track";

// F11-SITE-LEAD-07 — la lógica del formulario, sin navegador.

const filled = {
  name: "  Ana Torres ",
  email: " ana@example.com ",
  country: "MX",
  plan: "pro",
  businessType: "",
  message: "",
  consent: true,
  website: "",
};

describe("planFromSearch", () => {
  it("lee el plan que eligió el botón de la tarjeta", () => {
    expect(planFromSearch("?plan=pro")).toBe("pro");
    expect(planFromSearch("?utm_source=x&plan=custom")).toBe("custom");
  });

  it("un plan que no existe se ignora: el formulario abre en «Todavía no sé»", () => {
    expect(planFromSearch("?plan=enterprise")).toBeNull();
    expect(planFromSearch("")).toBeNull();
  });
});

describe("validateLead", () => {
  it("un formulario bien lleno no tiene errores", () => {
    expect(validateLead(filled)).toEqual({});
  });

  it("nombre, correo y consentimiento son obligatorios; giro y mensaje, no", () => {
    expect(validateLead({ ...filled, name: "   ", email: "", consent: false })).toEqual({
      name: "required",
      email: "required",
      consent: "consent",
    });
  });

  it("un correo a medias se dice como tal, no como «falta»", () => {
    expect(validateLead({ ...filled, email: "ana@" })).toEqual({ email: "email" });
    expect(validateLead({ ...filled, email: "ana example.com" })).toEqual({ email: "email" });
  });
});

describe("buildLeadPayload", () => {
  const context = {
    route: "es-mx" as const,
    sourceUrl: "https://sellpointy.com/es-mx/?plan=pro#contact",
    consentText: "Acepto que SellPointy me escriba…",
    elapsedMs: 8421.7,
  };

  it("arma lo que espera POST /public/leads, recortando espacios", () => {
    expect(buildLeadPayload(filled, context)).toEqual({
      name: "Ana Torres",
      email: "ana@example.com",
      country: "MX",
      locale: "es",
      route: "es-mx",
      planInterest: "pro",
      consent: true,
      consentText: "Acepto que SellPointy me escriba…",
      sourceUrl: "https://sellpointy.com/es-mx/?plan=pro#contact",
      website: "",
      elapsedMs: 8422,
    });
  });

  it("los opcionales solo viajan si se llenaron", () => {
    const payload = buildLeadPayload(
      { ...filled, businessType: "Farmacias", message: " Tengo dos sucursales " },
      context,
    );
    expect(payload.businessType).toBe("Farmacias");
    expect(payload.message).toBe("Tengo dos sucursales");
  });

  it("el idioma sale de la ruta: es el de la respuesta automática", () => {
    expect(buildLeadPayload(filled, { ...context, route: "fr-ca" }).locale).toBe("fr");
  });

  it("la trampa viaja tal cual: el que decide qué hacer con ella es el API", () => {
    expect(buildLeadPayload({ ...filled, website: "http://spam" }, context).website).toBe(
      "http://spam",
    );
  });
});

describe("el contrato con el API (los esquemas viven en @sellpoint/shared)", () => {
  // Si el formulario y `POST /public/leads` dejan de coincidir, el prospecto
  // recibe un 400 y se va. Que truene aquí, no en producción.
  const context = {
    route: "fr-ca" as const,
    sourceUrl: "https://sellpointy.com/fr-ca/?plan=custom#contact",
    consentText: "J'accepte que SellPointy m'écrive…",
    elapsedMs: 9000,
  };

  it("lo que arma el formulario pasa el esquema del API", () => {
    const full = {
      ...filled,
      country: "CA",
      plan: "custom",
      businessType: "Boulangeries",
      message: "Bonjour",
    };
    for (const fields of [filled, full]) {
      const result = siteLeadSchema.safeParse(buildLeadPayload(fields, context));
      expect(result.success ? [] : result.error.issues).toEqual([]);
    }
  });

  it("los planes del formulario son exactamente los que el API acepta", () => {
    for (const plan of LEAD_PLANS) {
      const payload = buildLeadPayload({ ...filled, plan }, context);
      expect(siteLeadSchema.safeParse(payload).success, plan).toBe(true);
    }
  });

  it("los cinco eventos del sitio son los cinco del API", () => {
    for (const event of SITE_EVENTS) {
      const result = siteEventSchema.safeParse({
        event,
        market: "ca",
        locale: "fr",
        section: "plans",
      });
      expect(result.success, event).toBe(true);
    }
  });
});
