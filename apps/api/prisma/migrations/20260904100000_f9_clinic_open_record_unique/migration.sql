-- F9-CLINIC-27 — un paciente no puede tener DOS consultas abiertas el mismo día.
--
-- El servicio ya lo comprueba (y responde 409 con el folio a continuar), pero
-- entre el chequeo y el INSERT cabe otra transacción: dos médicos que abren a
-- la vez. Que la regla viva también en la base es lo único que la vuelve
-- imposible en lugar de improbable.
--
-- Parcial a propósito: solo las ABIERTAS estorban. Un paciente acumula todos
-- los folios cerrados que quiera del mismo día (vuelve por la tarde), y una
-- consulta vencida de ayer no bloquea la de hoy porque su fecha es otra.
-- Prisma no modela índices parciales: vive en SQL y se documenta en el modelo.
CREATE UNIQUE INDEX "medical_clinic_records_one_open_per_day"
  ON "medical_clinic_records" ("tenant_id", "patient_customer_id", "consultation_date")
  WHERE "status" = 'open';
