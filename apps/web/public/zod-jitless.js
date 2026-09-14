/*
 * Zod SIN compilación en caliente, desde ANTES de que cargue la app
 * (Carlos, 2026-09-14).
 *
 * Zod 4 prueba `Function("")` para compilar sus validaciones, y lo hace al
 * CREAR cada esquema de objeto. La CSP de producción no permite evaluar texto
 * (`script-src 'self'`), así que el navegador bloquea la prueba y Chrome la
 * reporta como «Content Security Policy of your site blocks the use of eval».
 * No rompe nada: Zod la atrapa y valida sin compilar.
 *
 * Por qué es un archivo aparte y no `z.config()` en el código: se probó
 * importar la configuración PRIMERO en `main.tsx`, y en producción el aviso
 * siguió. Al empaquetar, ese código cae en el cuerpo del archivo de entrada,
 * y los archivos que la entrada importa —donde se crean esquemas al cargar—
 * se ejecutan ANTES que ese cuerpo.
 *
 * Zod 4 guarda su configuración en `globalThis.__zod_globalConfig` y solo lo
 * crea si no existe. Este script, clásico y sin `defer`, corre antes que
 * cualquier módulo: Zod nace ya en `jitless`, en todos los archivos.
 *
 * Archivo propio y no un <script> en línea: la CSP prohíbe los scripts en
 * línea, y este vive en el mismo origen ('self').
 */
globalThis.__zod_globalConfig = Object.assign(globalThis.__zod_globalConfig || {}, {
  jitless: true,
});
