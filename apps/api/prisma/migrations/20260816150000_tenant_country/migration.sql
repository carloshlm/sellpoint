-- Ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md §2 "El problema abierto: las
-- etiquetas no son universales" — opción B): campo de país del tenant.
-- Aditiva y nullable — un tenant preexistente sigue operando con `country`
-- en NULL hasta que vuelva a pasar el paso 1 del wizard (ver
-- `apps/web/src/lib/tenant/steps.ts`). Sin CHECK SQL de países a propósito:
-- la validación vive en `updateTenantSchema` (`isCountryCode` de
-- `@sellpoint/shared`), la misma fuente que alimenta el selector del front.
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "country" CHAR(2);
