-- Backfill de suscripciones para los tenants anteriores a F7 (2026-09-02).
--
-- El provisioning crea el trial en la misma transacción que el tenant
-- (F7-CORE-03), pero los negocios registrados ANTES de la fase de cobros
-- quedaron sin fila: EntitlementsService los resuelve como plan free y el
-- free tier es de solo lectura, así que ni siquiera podían terminar el
-- onboarding (402 en el PATCH del paso 1; visto en producción con un negocio
-- de prueba).
--
-- Reciben el MISMO trial que un registro nuevo: 14 días de Plus contados
-- desde que corre la migración, con el fin al arranque del día 15 en la zona
-- del negocio (misma semántica que `dueInstant(localCalendarDate(...))`).
-- Idempotente: solo inserta donde no hay fila. Sin audit_log: una migración
-- no tiene actor; la fecha de `created_at` es el rastro.
--
-- ⚠ El caché de entitlements (Redis, 300 s) sigue diciendo free hasta que
-- expire: quien esté logueado escribe a los 5 minutos, no al instante.

INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at, created_at, updated_at)
SELECT
  t.id,
  p.id,
  'trialing',
  (((now() AT TIME ZONE t.timezone)::date + 15)::timestamp) AT TIME ZONE t.timezone,
  now(),
  now()
FROM tenants t
CROSS JOIN plans p
WHERE p.code = 'plus'
  AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.tenant_id = t.id);
