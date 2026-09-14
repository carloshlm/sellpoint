import { z } from "zod";

/**
 * Zod SIN compilación en caliente (Carlos, 2026-09-14).
 *
 * Zod 4 intenta acelerar la validación compilando código con `new Function`.
 * Para saber si puede, al arrancar PRUEBA `Function("")` una vez. La CSP de
 * producción no permite evaluar texto (`script-src 'self'`, sin
 * `unsafe-eval`), así que el navegador bloquea la prueba, Zod la atrapa y
 * sigue sin compilar: no rompe nada, pero Chrome la reporta en su panel de
 * avisos como «Content Security Policy of your site blocks the use of eval».
 *
 * Con `jitless` Zod ni lo intenta: el propio código de Zod 4.4 dice que salta
 * la prueba bajo `jitless` justo porque las CSP estrictas la reportan. La
 * validación de formularios no nota la diferencia.
 *
 * Se importa PRIMERO en `main.tsx`: los imports se ejecutan en orden, y la
 * configuración tiene que llegar antes de que cualquier módulo valide algo.
 */
z.config({ jitless: true });
