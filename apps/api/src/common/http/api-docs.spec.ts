import { exposeApiDocs } from "./api-docs";

/**
 * F10-SEC-02 — la documentación del API (`/api/docs`, OpenAPI) no es pública
 * en producción. No expone datos, pero sí el mapa completo de rutas, y una
 * persona sin sesión no tiene por qué verlo. En desarrollo y en pruebas
 * sigue disponible: es donde se usa.
 */
describe("exposeApiDocs", () => {
  it.each(["development", "test"] as const)("en %s la documentación se monta", (env) => {
    expect(exposeApiDocs(env)).toBe(true);
  });

  it("en producción no se monta", () => {
    expect(exposeApiDocs("production")).toBe(false);
  });
});
