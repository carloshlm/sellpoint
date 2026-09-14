import { shouldEnableSentry, sinSesiones } from "./sentry";

/**
 * F6-WATCH-02: Sentry SOLO en producción real. La MISMA imagen del front
 * sirve en prod y sandbox (VITE_API_URL relativo), así que el DSN viaja
 * bakeado en ambas — el gate es el HOSTNAME en runtime, igual que el banner
 * de sandbox. Sin gate, cada experimento del sandbox ensuciaría el proyecto
 * de Sentry con errores que nadie debe atender.
 */
describe("shouldEnableSentry", () => {
  const DSN = "https://abc123@o000.ingest.sentry.io/000";

  it("solo con DSN presente Y el hostname de producción", () => {
    expect(shouldEnableSentry("app.sellpointy.com", DSN)).toBe(true);
  });

  it("el sandbox NUNCA reporta, ni con DSN bakeado", () => {
    expect(shouldEnableSentry("sandbox.sellpointy.com", DSN)).toBe(false);
  });

  it("localhost y dominios viejos tampoco", () => {
    expect(shouldEnableSentry("localhost", DSN)).toBe(false);
    expect(shouldEnableSentry("system.laradoc.com", DSN)).toBe(false);
  });

  it("sin DSN no hay Sentry en ningún lado", () => {
    expect(shouldEnableSentry("app.sellpointy.com", "")).toBe(false);
    expect(shouldEnableSentry("app.sellpointy.com", undefined)).toBe(false);
  });
});

/**
 * Carlos (2026-09-14): la LEY es «solo errores», y `@sentry/browser` 10 trae
 * de fábrica un aviso de sesión en cada carga de página. Se quita ESE y nada
 * más: lo que captura errores tiene que seguir.
 */
describe("sinSesiones", () => {
  const deFabrica = [
    { name: "InboundFilters" },
    { name: "BrowserApiErrors" },
    { name: "GlobalHandlers" },
    { name: "LinkedErrors" },
    { name: "Dedupe" },
    { name: "BrowserSession" },
  ];

  it("quita el aviso de sesión", () => {
    expect(sinSesiones(deFabrica).map((i) => i.name)).not.toContain("BrowserSession");
  });

  it("conserva TODO lo que captura errores, en su orden", () => {
    expect(sinSesiones(deFabrica).map((i) => i.name)).toEqual([
      "InboundFilters",
      "BrowserApiErrors",
      "GlobalHandlers",
      "LinkedErrors",
      "Dedupe",
    ]);
  });
});
