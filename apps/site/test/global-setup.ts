import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Varias barreras leen el sitio YA CONSTRUIDO (`dist/`): lo que importa es lo
// que llega al navegador, no lo que dice el código fuente. Se construye una
// sola vez, antes de todas las pruebas.
//
// Por la línea de comandos y no con `build()` de "astro": dentro de Vitest ese
// import pasa por el transformador de Vite y llega sin la función.
export default function setup() {
  try {
    execFileSync("pnpm", ["exec", "astro", "build", "--silent"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "pipe",
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`astro build falló:\n${stdout ?? ""}\n${stderr ?? ""}`);
  }
}
