import { describe, expect, it } from "vitest";
import {
  normalizeReferrerDomain,
  SITE_EVENT_NAMES,
  siteEventSchema,
  siteEventsQuerySchema,
} from "./site-events";

/**
 * F11-SITE-SEO-06 — la medición propia. Lo que NO se guarda es la mitad del
 * diseño: sin IP, sin agente de usuario y sin identificador de visitante, así
 * que desde esa tabla no se reconstruye a nadie y no hace falta consentimiento.
 */

function evento(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { event: "cta_click", market: "mx", locale: "es", ...overrides };
}

describe("siteEventSchema (F11-SITE-SEO-06)", () => {
  it("los CINCO eventos son lista cerrada", () => {
    expect([...SITE_EVENT_NAMES]).toEqual([
      "cta_click",
      "form_open",
      "form_submit",
      "market_change",
      "plans_expand",
    ]);
  });

  it("acepta el evento mínimo", () => {
    expect(siteEventSchema.safeParse(evento()).success).toBe(true);
  });

  it("un evento que no está en la lista se rechaza: la tabla no es un basurero", () => {
    expect(siteEventSchema.safeParse(evento({ event: "scroll_depth" })).success).toBe(false);
  });

  it("el mercado y el idioma también son listas cerradas", () => {
    expect(siteEventSchema.safeParse(evento({ market: "br" })).success).toBe(false);
    expect(siteEventSchema.safeParse(evento({ locale: "pt" })).success).toBe(false);
  });

  it("sección y plan son opcionales y se guardan como NULL si no vienen", () => {
    const resultado = siteEventSchema.safeParse(evento());

    expect(resultado.data?.section).toBeNull();
    expect(resultado.data?.plan).toBeNull();
    expect(resultado.data?.referrerDomain).toBeNull();
  });

  it("el plan del evento usa la misma lista cerrada que el formulario", () => {
    expect(siteEventSchema.safeParse(evento({ plan: "custom" })).success).toBe(true);
    expect(siteEventSchema.safeParse(evento({ plan: "enterprise" })).success).toBe(false);
  });

  it("una sección larguísima se rechaza", () => {
    expect(siteEventSchema.safeParse(evento({ section: "x".repeat(100) })).success).toBe(false);
  });
});

describe("normalizeReferrerDomain (F11-SITE-SEO-06)", () => {
  it("de una URL completa deja SOLO el dominio: la ruta puede llevar datos", () => {
    expect(normalizeReferrerDomain("https://www.google.com/search?q=punto+de+venta")).toBe(
      "google.com",
    );
  });

  it("un dominio pelado se queda igual, en minúsculas", () => {
    expect(normalizeReferrerDomain("Google.COM")).toBe("google.com");
  });

  it("quita el `www.` para que no haya dos filas del mismo origen", () => {
    expect(normalizeReferrerDomain("www.facebook.com")).toBe("facebook.com");
  });

  it("conserva un subdominio que NO es www: `l.instagram.com` no es Instagram", () => {
    expect(normalizeReferrerDomain("https://l.instagram.com/?u=algo")).toBe("l.instagram.com");
  });

  it("lo que no parsea se descarta en vez de guardarse crudo", () => {
    expect(normalizeReferrerDomain("no es un dominio")).toBeNull();
    expect(normalizeReferrerDomain("")).toBeNull();
    expect(normalizeReferrerDomain(undefined)).toBeNull();
    expect(normalizeReferrerDomain(null)).toBeNull();
  });

  it("descarta el puerto y el usuario: no son el origen", () => {
    expect(normalizeReferrerDomain("https://user:pass@ejemplo.com:8443/x")).toBe("ejemplo.com");
  });
});

describe("siteEventsQuerySchema (F11-SITE-LEAD-09)", () => {
  it("el rango es obligatorio y el mercado es opcional", () => {
    expect(siteEventsQuerySchema.safeParse({ from: "2026-09-01", to: "2026-09-30" }).success).toBe(
      true,
    );
    expect(siteEventsQuerySchema.safeParse({ to: "2026-09-30" }).success).toBe(false);
  });

  it("filtrar por un mercado que no existe se rechaza", () => {
    expect(
      siteEventsQuerySchema.safeParse({ from: "2026-09-01", to: "2026-09-30", market: "br" })
        .success,
    ).toBe(false);
  });
});
