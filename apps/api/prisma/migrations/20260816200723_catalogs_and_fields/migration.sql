-- CreateEnum
CREATE TYPE "catalog_field_type" AS ENUM ('text', 'number', 'lookup');

-- CreateTable
CREATE TABLE "catalogs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "system_key" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_fields" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "catalog_field_type" NOT NULL,
    "lookup_catalog_id" UUID,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalog_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalogs_tenant_id_idx" ON "catalogs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogs_tenant_id_name_key" ON "catalogs"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "catalog_fields_tenant_id_idx" ON "catalog_fields"("tenant_id");

-- CreateIndex
CREATE INDEX "catalog_fields_lookup_catalog_id_idx" ON "catalog_fields"("lookup_catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_fields_catalog_id_key_key" ON "catalog_fields"("catalog_id", "key");

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_fields" ADD CONSTRAINT "catalog_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_fields" ADD CONSTRAINT "catalog_fields_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_fields" ADD CONSTRAINT "catalog_fields_lookup_catalog_id_fkey" FOREIGN KEY ("lookup_catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- F2-DB-02: lo que Prisma no expresa (índices parciales y CHECK constraints)
-- ─────────────────────────────────────────────────────────────────────────

-- UN solo catálogo del sistema por clave y por tenant. Sin esto, un bug en
-- `TenantsService.provision()` (o una migración de backfill corrida dos veces)
-- dejaría al tenant con dos catálogos 'products' y el motor no sabría cuál es
-- el bueno. Parcial porque los subcatálogos tienen `system_key` NULL y NULL no
-- colisiona consigo mismo.
CREATE UNIQUE INDEX "catalogs_tenant_id_system_key_key"
  ON "catalogs" ("tenant_id", "system_key")
  WHERE "system_key" IS NOT NULL;

-- Un campo lookup SIEMPRE apunta a un catálogo, y uno que no es lookup NUNCA
-- arrastra un destino. Los dos estados que esto prohíbe son silenciosos y
-- caros: un lookup sin destino rompe el picker en runtime, y un texto con
-- destino colgado engaña a cualquiera que lea la fila.
ALTER TABLE "catalog_fields"
  ADD CONSTRAINT "catalog_fields_lookup_target_check"
  CHECK (
    ("field_type" = 'lookup' AND "lookup_catalog_id" IS NOT NULL)
    OR ("field_type" <> 'lookup' AND "lookup_catalog_id" IS NULL)
  );
