import { describe, expect, it } from "vitest";
import {
  DEFAULT_TICKET_SETTINGS,
  footerMessageSchema,
  TICKET_FOOTER_MAX,
  TICKET_LOGO_PRESETS,
  TICKET_LOGO_SVG,
  ticketLogoSchema,
} from "./ticket-settings";

/**
 * F4-TICKETCFG-01 — el contrato del ticket es código compartido: el API pinta
 * los presets con el MISMO string que el web previsualiza, y los dos validan
 * el pie con el mismo schema.
 */
describe("los logotipos de fábrica del ticket (F4-TICKETCFG-01)", () => {
  it("son seis, únicos, y cada uno tiene su SVG", () => {
    expect(TICKET_LOGO_PRESETS).toEqual([
      "food",
      "cafe",
      "pharmacy",
      "store",
      "clinic",
      "workshop",
    ]);
    expect(new Set(TICKET_LOGO_PRESETS).size).toBe(6);
    for (const preset of TICKET_LOGO_PRESETS) {
      expect(TICKET_LOGO_SVG[preset]).toContain("<svg");
    }
  });

  it("cada SVG es monocromo: viewBox de 24, trazo negro y ningún relleno de color", () => {
    for (const preset of TICKET_LOGO_PRESETS) {
      const svg = TICKET_LOGO_SVG[preset];
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="#000000"');
      expect(svg).toContain('fill="none"');
      // Ningún color que no sea el negro del trazo: en térmica no existe otro.
      const colores = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,6}|[a-z]+)"/g)].map(
        (m) => m[1],
      );
      expect(colores.every((c) => c === "#000000" || c === "none")).toBe(true);
      // Y trae al menos un trazo real, no un marco vacío.
      expect(svg).toMatch(/<(path|circle|line|rect|polyline|polygon)\b/);
    }
  });

  it("el pie es una línea de hasta 160 caracteres, recortada", () => {
    expect(footerMessageSchema.safeParse("  ¡Gracias por su preferencia!  ").data).toBe(
      "¡Gracias por su preferencia!",
    );
    expect(footerMessageSchema.safeParse("a".repeat(TICKET_FOOTER_MAX)).success).toBe(true);
    expect(footerMessageSchema.safeParse("a".repeat(TICKET_FOOTER_MAX + 1)).success).toBe(false);
    expect(footerMessageSchema.safeParse("Gracias\nVuelva pronto").success).toBe(false);
    expect(footerMessageSchema.safeParse("   ").success).toBe(false);
  });

  it("el logotipo es none, un preset conocido o custom; un preset inventado rebota", () => {
    expect(ticketLogoSchema.safeParse({ kind: "none" }).success).toBe(true);
    expect(ticketLogoSchema.safeParse({ kind: "preset", preset: "pharmacy" }).success).toBe(true);
    expect(ticketLogoSchema.safeParse({ kind: "preset", preset: "bank" }).success).toBe(false);
    expect(ticketLogoSchema.safeParse({ kind: "custom" }).success).toBe(true);
    expect(DEFAULT_TICKET_SETTINGS).toEqual({
      showBusinessName: true,
      showTaxId: true,
      showAddress: true,
      showPhone: true,
      showWarehouse: true,
      footerMessage: null,
      logo: { kind: "none" },
    });
  });
});
