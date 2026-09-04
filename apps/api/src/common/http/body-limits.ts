/**
 * El tope del body JSON, en UN solo lugar: lo aplica `main.ts` en producción y
 * `startTestApp` en los e2e. Si vivieran separados, un test podría pasar con
 * un límite que producción rechaza —o al revés, que fue lo que pasó con el
 * logotipo del ticket (2026-09-04): 2 MB de imagen en base64 caben en
 * producción y reventaban con `request entity too large` en el harness, que
 * corría con el default de 100 KB de Express.
 *
 * Por qué 6 MB: la importación del catálogo manda el CSV como texto (hasta 5
 * MB por regla de negocio) y el logotipo del ticket hasta 2 MB en base64 (~2.7
 * MB); se deja el parser por encima para que el 413 que ve el usuario venga
 * del service con su mensaje, no de un error crudo del parser.
 */
export const JSON_BODY_LIMIT = "6mb";
