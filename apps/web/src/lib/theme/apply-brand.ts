import { type BrandId, DEFAULT_BRAND, resolveBrand } from "./brands";

/**
 * Aplica una marca al documento (eje 1 del sistema de temas): escribe
 * `data-brand` en <html>, que activa el bloque de tokens de esa marca en
 * `index.css`. Es la ÚNICA forma de cambiar la marca activa.
 *
 * Estado actual: se llama con `DEFAULT_BRAND` al bootear (ver `main.tsx`).
 * Punto de extensión (F1-WEB-AUTH / bootstrap del tenant): cuando el login
 * devuelva la config del tenant, llamar `applyBrand(tenant.theme)` ahí — el
 * resto del sistema (CSS, componentes) ya está listo y no se toca.
 */
export function applyBrand(brand: BrandId = DEFAULT_BRAND): BrandId {
  const resolved = resolveBrand(brand);
  document.documentElement.dataset.brand = resolved;
  return resolved;
}
