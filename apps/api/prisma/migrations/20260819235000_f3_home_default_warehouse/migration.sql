-- F3-HOME-01 — el almacén ASIGNADO de un usuario.
--
-- Distinto del ALCANCE (`user_warehouse_scopes`, N-N, "dónde PUEDE operar",
-- vacío = todos): esto es UNO, "desde dónde opera por defecto". El POS de F4
-- no puede vender desde una lista — necesita un almacén concreto.
--
-- RESTRICT y no CASCADE: los almacenes no tienen endpoint de borrado (se
-- desactivan), así que esto es una red, no un camino esperado.

ALTER TABLE "users" ADD COLUMN "default_warehouse_id" UUID;

ALTER TABLE "users" ADD CONSTRAINT "users_default_warehouse_id_fkey"
  FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "users_default_warehouse_id_idx" ON "users" ("default_warehouse_id");

-- Backfill: en un tenant con UN SOLO almacén no hay ambigüedad posible — es
-- ese. Con dos o más, la decisión es del TenantAdmin y la columna queda null:
-- adivinar sería peor que preguntar.
UPDATE "users" u
   SET "default_warehouse_id" = w.id
  FROM "warehouses" w
 WHERE w."tenant_id" = u."tenant_id"
   AND w."is_active" = true
   AND (SELECT count(*) FROM "warehouses" w2
         WHERE w2."tenant_id" = u."tenant_id" AND w2."is_active" = true) = 1;
