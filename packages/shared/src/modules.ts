import { z } from "zod";

/**
 * F9-MOD-01 — el catálogo de módulos avanzados que un negocio puede tener
 * activados por encima de su plan base.
 *
 * Es CÓDIGO y no una tabla a propósito: un módulo sin código que lo
 * implemente no existe, así que su catálogo vive donde vive el código. Lo
 * que SÍ es dato es qué negocio tiene cuál (`tenant_modules`, F9-MOD-02).
 * Esta lista es la única fuente de verdad para el guard del API
 * (`@RequiresModule`), los toggles del backoffice y el grupo del menú del
 * cliente; los metadatos de UI (etiqueta, ícono, rutas) viven en el web.
 *
 * Activar cualquier módulo vuelve al negocio Premium con precio pactado
 * (decisión de Carlos, 2026-09-02).
 */
export const MODULE_KEYS = ["reception"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export const moduleKeySchema = z.enum(MODULE_KEYS);
