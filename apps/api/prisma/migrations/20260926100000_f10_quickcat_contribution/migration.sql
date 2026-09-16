-- F10-QUICKCAT-03 — de quién salió cada código que el catálogo global no tenía.
--
-- La carga rápida deja que un negocio dé de alta un producto que NADIE
-- conocía, y ese código se suma al catálogo que comparten todos. Guardar quién
-- lo aportó no es burocracia: es lo único que permite depurar por origen si un
-- negocio empieza a meter basura, y es lo que separa una fila nuestra de una
-- de Open Food Facts, que arrastra la obligación ODbL.
--
-- ⚠️ LA COLUMNA NO SE PUEDE LLAMAR `tenant_id`, Y ESO ES TODO EL DISEÑO.
--
-- `purge_tenant(uuid)` recorre en caliente `information_schema.columns` y
-- borra de TODA tabla base que tenga una columna llamada `tenant_id`:
--
--   WHERE c.column_name = 'tenant_id' AND c.table_name <> 'tenants'
--
-- Con ese nombre, eliminar un negocio se llevaría por delante las filas del
-- catálogo que usan todos los demás, en silencio y sin que ningún test lo
-- note. `contributed_by_tenant_id` queda fuera del barrido a propósito.
--
-- Tampoco lleva llave foránea a `tenants`: es PROCEDENCIA para auditar, no una
-- relación que alguien vaya a recorrer, y una purga no puede quedar bloqueada
-- por el catálogo compartido.
ALTER TABLE "global_barcode_catalog"
  ADD COLUMN "contributed_by_tenant_id" uuid,
  ADD COLUMN "contributed_at" timestamptz(6);

-- Una fila nuestra SIEMPRE dice de quién salió; una de Open Food Facts, nunca.
-- El CHECK es lo que impide que un INSERT sin sello se cuele como propio.
ALTER TABLE "global_barcode_catalog"
  ADD CONSTRAINT "global_barcode_catalog_contribution_check"
    CHECK (
      ("source" = 'tenant_contributed') =
      ("contributed_by_tenant_id" IS NOT NULL AND "contributed_at" IS NOT NULL)
    );

-- Para depurar por origen: «todo lo que aportó este negocio». Parcial porque
-- de 953,969 filas solo las aportadas tienen sello, y un índice sobre 953,969
-- NULL no sirve para nada.
CREATE INDEX "global_barcode_catalog_contributed_by_idx"
  ON "global_barcode_catalog" ("contributed_by_tenant_id")
  WHERE "contributed_by_tenant_id" IS NOT NULL;
