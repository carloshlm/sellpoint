-- F9-CLINIC-HC-05 (2026-09-08): de qué expediente se heredó una sección, ADITIVA.
--
-- Los antecedentes son del PACIENTE, no de la consulta: al abrir un
-- expediente nuevo se copian del anterior (AHF, APP, APNP, AGO, alergias,
-- medicamentos actuales y Datos Generales, que ya se copiaba) y esta columna
-- dice de dónde vienen. El primer Guardar del médico la pone en NULL: la hizo
-- suya. Una fila capturada a mano desde el inicio siempre está en NULL.
--
-- SET NULL: si el expediente origen se borra, la sección heredada sigue
-- siendo válida (los datos ya son de este expediente); solo pierde la seña
-- de dónde vino. Una columna, cero DROP, cero ALTER TYPE: la API vieja
-- ignora columnas que no lee.
--
-- Deshacer, si hiciera falta:
--   ALTER TABLE "medical_clinic_record_sections" DROP COLUMN "source_record_id";
ALTER TABLE "medical_clinic_record_sections" ADD COLUMN "source_record_id" UUID;

ALTER TABLE "medical_clinic_record_sections"
  ADD CONSTRAINT "medical_clinic_record_sections_source_record_id_fkey"
  FOREIGN KEY ("source_record_id") REFERENCES "medical_clinic_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "medical_clinic_record_sections_source_record_id_idx"
  ON "medical_clinic_record_sections"("source_record_id");
