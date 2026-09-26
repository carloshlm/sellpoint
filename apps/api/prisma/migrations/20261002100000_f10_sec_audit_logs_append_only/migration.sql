-- F10-SEC-01 — la bitácora de auditoría es de solo escritura.
--
-- `audit_logs` es la prueba de «quién hizo qué y cuándo» (f1-auth AD-10).
-- Hasta hoy el rol de la aplicación podía reescribirla o borrarla: con la
-- conexión de la app bastaba para limpiar el rastro, y una bitácora que se
-- puede reescribir no prueba nada. Lo destapó SEGURIDAD.md (2026-09-25).
--
-- Mismo mecanismo que `stock_movements` (F3-DB-01): se blinda por PRIVILEGIO,
-- no por trigger, porque un renglón de la bitácora NUNCA se edita. La app
-- inserta y lee, y no más. Ningún código del API hacía update ni delete sobre
-- esta tabla, así que nada cambia para la aplicación.
--
-- Borrar un negocio entero sigue funcionando: `purge_tenant()` corre como
-- SECURITY DEFINER, con el dueño de la función y no con `sellpoint_app`. Y la
-- guarda del IF es la de siempre: en una base recién creada el rol puede no
-- existir todavía.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sellpoint_app') THEN
    REVOKE UPDATE, DELETE ON "audit_logs" FROM sellpoint_app;
  END IF;
END
$$;
