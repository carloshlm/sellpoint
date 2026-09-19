// El espejo en TypeScript del token `--blue`. Existe porque el `theme-color`
// del <head> es un atributo de HTML y no puede leer una variable de CSS.
// `test/tokens.test.ts` falla si deja de coincidir con `tokens.css`.
export const BRAND_BLUE = "#1E3FD8";
