import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInThisContext } from "node:vm";
import { z } from "zod";

/**
 * BARRERA: Zod nace sin compilación en caliente (Carlos, 2026-09-14).
 *
 * Zod 4 prueba `Function("")` al CREAR cada esquema de objeto; la CSP de
 * producción lo bloquea y Chrome lo reporta. Un primer arreglo configuró Zod
 * importando un módulo PRIMERO en `main.tsx`, y en producción el aviso siguió:
 * al empaquetar, ese código cae en el cuerpo del archivo de entrada, que corre
 * DESPUÉS de los archivos que importa, donde ya se crearon esquemas. Se
 * verificó en el bundle vivo: la llamada quedó en la posición 8060, detrás de
 * 26 imports que terminaban en la 7270.
 *
 * El arreglo que sí funciona se apoya en tres cosas, y cada una tiene su prueba:
 * que el script clásico cargue ANTES del módulo, que deje `jitless` puesto, y
 * que Zod de verdad lea ese objeto global. Si una versión nueva de Zod cambia
 * dónde guarda su configuración, esta prueba se pone roja en vez de dejar el
 * aviso de vuelta en silencio.
 */
const WEB = join(__dirname, "..", "..");

describe("Zod sin compilación en caliente", () => {
  it("el script clásico carga ANTES que el módulo principal, sin defer ni async", () => {
    const html = readFileSync(join(WEB, "index.html"), "utf8");
    const script = html.match(/<script\s+src="\/zod-jitless\.js"\s*><\/script>/);
    const modulo = html.indexOf('<script type="module"');

    expect(script).not.toBeNull();
    expect(modulo).toBeGreaterThan(-1);
    expect(script?.index).toBeLessThan(modulo);
    // `defer`, `async` o `type="module"` lo mandarían DESPUÉS del bundle.
    expect(script?.[0]).not.toMatch(/defer|async|type=/);
  });

  it("el script deja `jitless` puesto en la configuración global de Zod", () => {
    const fuente = readFileSync(join(WEB, "public", "zod-jitless.js"), "utf8");
    runInThisContext(fuente);

    expect(
      (globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig,
    ).toMatchObject({ jitless: true });
  });

  it("Zod lee ESE objeto global: la configuración del script es la suya", () => {
    const global = (globalThis as { __zod_globalConfig?: object }).__zod_globalConfig;

    // Mismo objeto, no una copia: si Zod dejara de leer el global, esto falla.
    expect(z.config()).toBe(global);
    expect(z.config().jitless).toBe(true);
  });

  it("y valida igual que siempre", () => {
    const esquema = z.object({ email: z.email(), edad: z.number().int().min(0) });

    expect(esquema.safeParse({ email: "ana@acme.mx", edad: 30 }).success).toBe(true);
    expect(esquema.safeParse({ email: "no-es-correo", edad: -1 }).success).toBe(false);
  });
});
