-- Normaliza los phone ya guardados a E.164 canónico (2026-08-25).
--
-- El primer despliegue del campo (20260825200000_tenant_phone) aceptaba
-- separadores ("+52 55 1234 5678"); el DTO ahora exige la forma canónica
-- (+525512345678) porque la UI compone país + número y la forma bonita es
-- asunto de quien pinta, no de quien guarda. Esta pasada limpia lo poco que
-- alcanzó a guardarse con el formato viejo — sin ella quedarían filas que el
-- propio API ya no aceptaría de vuelta.
--
-- Idempotente por construcción: quitar todo lo que no sea dígito o '+' de un
-- valor ya canónico lo deja idéntico. Sin CHECK SQL del formato: la
-- validación vive en updateTenantSchema (isE164, @sellpoint/shared), el
-- mismo criterio que country.
UPDATE "tenants"
SET "phone" = regexp_replace("phone", '[^0-9+]', '', 'g')
WHERE "phone" IS NOT NULL
  AND "phone" <> regexp_replace("phone", '[^0-9+]', '', 'g');
