-- El tema inicial del wizard (Carlos, 2026-08-25).
--
-- El paso 3 del onboarding guarda la elección (light | dark | sand | grape)
-- aunque los ESTILOS de cada tema lleguen después: la columna existe para que
-- la preferencia no se pierda entre el wizard y el selector de Mi perfil.
--
-- Nullable y aditiva: un tenant anterior al campo opera con NULL (el front lo
-- lee como light). Sin CHECK SQL — la validación del catálogo de temas vive
-- en updateTenantSchema (enum), el mismo criterio que country.
ALTER TABLE "tenants" ADD COLUMN "theme" VARCHAR(16);
