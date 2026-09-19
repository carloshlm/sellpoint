import { isPublicSitePath, resolveCorsOptions } from "./cors";

/**
 * F11-SITE-LEAD-06 — el sitio público (`sellpointy.com`) es un ORIGEN
 * distinto del de la aplicación (`app.sellpointy.com`), así que su formulario
 * y su medición necesitan CORS. Lo que se acota acá es cuánto se le concede.
 */
const ORIGINS = ["https://app.sellpointy.com", "https://sellpointy.com"];

describe("resolveCorsOptions (F11-SITE-LEAD-06)", () => {
  it("la aplicación sigue igual: los orígenes de siempre, CON credenciales", () => {
    const opciones = resolveCorsOptions("/auth/login", ORIGINS);

    expect(opciones).toMatchObject({ origin: ORIGINS, credentials: true });
    expect(opciones.exposedHeaders).toEqual(["Content-Disposition"]);
  });

  /**
   * Los dos endpoints del sitio no leen ni escriben la cookie de refresh: con
   * `credentials: false`, el navegador no manda cookies ahí ni aunque alguien
   * lo intente desde otra pestaña.
   */
  it("los endpoints públicos del sitio van SIN credenciales", () => {
    const opciones = resolveCorsOptions("/public/leads", ORIGINS);

    expect(opciones).toMatchObject({ origin: ORIGINS, credentials: false });
  });

  it("y solo con los métodos que existen ahí", () => {
    expect(resolveCorsOptions("/public/site-events", ORIGINS).methods).toEqual(["POST", "OPTIONS"]);
  });

  it("el prefijo /api de nginx no despista al acotado", () => {
    expect(isPublicSitePath("/api/public/leads")).toBe(true);
    expect(isPublicSitePath("/public/site-events?x=1")).toBe(true);
  });

  /** Un prefijo que solo se PARECE no puede colarse en el trato flojo. */
  it("una ruta que apenas empieza parecido NO es pública", () => {
    expect(isPublicSitePath("/publicidad")).toBe(false);
    expect(isPublicSitePath("/products/public")).toBe(false);
    expect(isPublicSitePath(undefined)).toBe(false);
  });
});
