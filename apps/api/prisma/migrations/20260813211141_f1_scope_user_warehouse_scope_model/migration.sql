-- F1-SCOPE-01: preparación de warehouse scoping. `warehouse_id` NO lleva FK
-- todavía: la tabla `warehouses` no existe hasta F2. Cuando aterrice, una
-- migración de F2 agrega `ALTER TABLE user_warehouse_scopes ADD CONSTRAINT
-- ... FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)` — sin backfill
-- porque la columna ya nace NOT NULL.
--
-- PK compuesta (user_id, warehouse_id): un usuario puede tener acceso a
-- varios warehouses, y el mismo par no se repite. `tenant_id` está
-- desnormalizado desde `users` a propósito, mismo patrón que
-- refresh_tokens/email_verification_tokens/password_reset_tokens (f1-auth
-- AD-3): la policy RLS de F1-SCOPE-02 compara esta columna directo, sin JOIN.
--
-- Los grants para sellpoint_app NO se declaran acá: ya los cubre
-- `ALTER DEFAULT PRIVILEGES` de la migración 20260806172006_app_db_user, que
-- aplica a toda tabla futura creada por el owner de las migraciones.
CREATE TABLE "user_warehouse_scopes" (
    "user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warehouse_scopes_pkey" PRIMARY KEY ("user_id","warehouse_id")
);

-- CreateIndex
CREATE INDEX "user_warehouse_scopes_tenant_id_idx" ON "user_warehouse_scopes"("tenant_id");

-- AddForeignKey
ALTER TABLE "user_warehouse_scopes" ADD CONSTRAINT "user_warehouse_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouse_scopes" ADD CONSTRAINT "user_warehouse_scopes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
