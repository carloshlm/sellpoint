-- F3-DB-04 — RLS en las tablas de Fase 3 + append-only de los movimientos.
--
-- Patrón canónico heredado de F1 y F2 (`20260816202400_f2_enable_rls`), con
-- las tres decisiones que ya costaron incidentes:
--
--   1. ENABLE + **FORCE**: sin FORCE, el owner de las tablas queda exento de
--      sus propias policies. Como las migraciones y el seed conectan con ese
--      rol, el aislamiento sería teatro para cualquier conexión que lo use.
--   2. **NULLIF(current_setting(...), '')**: una conexión reciclada por el
--      pool puede devolver '' en vez de NULL, y `''::uuid` REVIENTA en vez de
--      filtrar a cero filas.
--   3. `USING` **y** `WITH CHECK` idénticos: el USING filtra lo que se lee, el
--      WITH CHECK impide escribir filas de otro tenant. Sin el segundo, un
--      INSERT cross-tenant pasa.
--
-- ── Por qué esta migración llega tarde, y qué enseñó ─────────────────────
--
-- Estas seis tablas nacieron entre F3-DB-01 y F3-DB-03 SIN RLS, porque el
-- tablero juntaba el aislamiento de toda la fase en una tarea posterior.
-- Mientras tanto, un test de `DocumentsService` (F3-DOC-03) probó que un
-- usuario de otro tenant podía anular un documento ajeno: el service se
-- apoyaba en una RLS que todavía no existía. **Lección aplicada al tablero:
-- las tablas de lotes (F3-DB-06/07) traen su propia RLS en la misma migración
-- que las crea.** Una tabla no debería existir ni un commit sin aislamiento.
--
-- ── Dos mecanismos de append-only, y por qué no es el mismo ──────────────
--
-- `stock_movements` se blinda por PRIVILEGIO (`REVOKE UPDATE, DELETE`): la app
-- no puede reescribir un asiento ni queriendo. Es la barrera más fuerte y sirve
-- acá porque un movimiento NUNCA se edita.
--
-- `inventory_documents` **no puede blindarse igual**: un borrador se edita
-- hasta que se confirma, así que la app necesita conservar el UPDATE. Su
-- inmutabilidad la impone el trigger de F3-DOC-02, que mira el ESTADO en vez
-- del privilegio. Dos problemas distintos, dos herramientas distintas.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stock_movements',
    'inventory_documents',
    'inventory_document_lines',
    'transfers',
    'transfer_lines',
    'tenant_sequences'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Append-only de los movimientos, por privilegio
-- ─────────────────────────────────────────────────────────────────────────
--
-- Guardado con `IF EXISTS pg_roles` (patrón `units`/`currencies`): en un
-- entorno donde `sellpoint_app` todavía no exista, la migración no debe
-- caerse. Y va explícito porque el `ALTER DEFAULT PRIVILEGES` de F1 ya le
-- concedió todo sobre las tablas nuevas: hay que quitárselo después.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sellpoint_app') THEN
    REVOKE UPDATE, DELETE ON "stock_movements" FROM sellpoint_app;
  END IF;
END
$$;
