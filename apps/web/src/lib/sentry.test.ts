import { shouldEnableSentry } from "./sentry";

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
