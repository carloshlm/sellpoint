import { z } from "zod";
import "./zod-config";

/**
 * Carlos (2026-09-14): la CSP de producción bloqueaba la prueba de `new
 * Function` que Zod 4 hace al arrancar, y Chrome la reportaba. Con `jitless`
 * Zod no la intenta, y la validación sigue funcionando igual.
 */
describe("la configuración de Zod", () => {
  it("queda sin compilación en caliente: Zod no prueba `new Function`", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("y valida igual que siempre", () => {
    const esquema = z.object({ email: z.email(), edad: z.number().int().min(0) });
    expect(esquema.safeParse({ email: "ana@acme.mx", edad: 30 }).success).toBe(true);
    expect(esquema.safeParse({ email: "no-es-correo", edad: -1 }).success).toBe(false);
  });
});
