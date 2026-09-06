-- F9-CLINIC (Carlos, 2026-09-05): «Mostrar existencias al recetar». Apagado,
-- el buscador de medicamentos del médico no recibe la existencia (el API no
-- la manda, como en el punto de venta con `tenants.pos_shows_stock`).
-- Encendido por defecto: ningún consultorio actual nota el cambio.
ALTER TABLE "medical_clinic_settings" ADD COLUMN "shows_stock" BOOLEAN NOT NULL DEFAULT true;
