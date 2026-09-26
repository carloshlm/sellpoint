import type { Env } from "../../config/env.schema";

/**
 * F10-SEC-02 — ¿se monta la documentación del API (`/api/docs`, OpenAPI)?
 *
 * En desarrollo y en pruebas sí: es donde se consulta. En producción no: no
 * expone datos, pero sí el mapa completo de rutas, y quien no tiene sesión no
 * tiene por qué verlo. Lo destapó SEGURIDAD.md el 2026-09-25 (`/api/docs`
 * respondía 200 sin sesión en app.sellpointy.com).
 *
 * Es una función y no un `if` en `main.ts` para que tenga prueba: el arranque
 * real no corre en ningún test.
 */
export function exposeApiDocs(nodeEnv: Env["NODE_ENV"]): boolean {
  return nodeEnv !== "production";
}
