-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'active', 'suspended');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "employee_number" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name_paternal" TEXT NOT NULL,
    "last_name_maternal" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "locale" CHAR(2) NOT NULL DEFAULT 'es',
    "email_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraint de locales soportados (Prisma no soporta CHECK en el schema)
ALTER TABLE "users"
    ADD CONSTRAINT "users_locale_check" CHECK ("locale" IN ('es', 'en'));
