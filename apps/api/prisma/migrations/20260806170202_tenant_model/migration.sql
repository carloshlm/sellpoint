-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "currency" CHAR(3) NOT NULL DEFAULT 'MXN',
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CHECK constraint de currencies soportadas (Prisma no soporta CHECK en el
-- schema — se mantiene a mano acá; agregar moneda nueva = nueva migración)
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_currency_check" CHECK ("currency" IN ('MXN', 'USD'));
