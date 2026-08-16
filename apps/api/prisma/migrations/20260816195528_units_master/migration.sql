-- F2-DB-01: tabla MAESTRA de unidades de medida.
--
-- Global: sin `tenant_id` y sin RLS, igual que `currencies`. Las unidades no
-- son datos de un negocio — un kilogramo es el mismo para todos los tenants.
--
-- Los datos de REFERENCIA van acá y no en `prisma/seed.ts` (que es solo
-- dev/demo) para que lleguen a TODOS los entornos por el pipeline de
-- migraciones. Idempotente por ON CONFLICT.

-- CreateTable
CREATE TABLE "units" (
    "code" VARCHAR(8) NOT NULL,
    "name_es" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "units_pkey" PRIMARY KEY ("code")
);

-- `category` acotada: el conversor de F2-UOM solo sabe convertir DENTRO de una
-- categoría (l↔ml, kg↔gr) y deriva de ella el default de
-- `allow_fractional_input` de las presentaciones (count → solo enteros). Una
-- categoría desconocida rompería ambas cosas en silencio. Prisma no expresa
-- CHECK constraints, por eso va a mano.
ALTER TABLE "units"
  ADD CONSTRAINT "units_category_check"
  CHECK ("category" IN ('count', 'volume', 'weight', 'length'));

-- Catálogo inicial (IMPLEMENTACION.md, F2-DB-01). Los factores de conversión
-- NO viven en la DB: son del catálogo compartido de `packages/shared`
-- (F2-UOM-01), que es la misma fuente que consume el front — mismo criterio
-- que `ISO_COUNTRY_CODES` y `SUPPORTED_CURRENCIES`. Acá solo vive la identidad
-- de la unidad y su categoría.
INSERT INTO "units" ("code", "name_es", "name_en", "category", "is_active") VALUES
  ('unit', 'Unidad',     'Unit',       'count',  true),
  ('ml',   'Mililitro',  'Milliliter', 'volume', true),
  ('l',    'Litro',      'Liter',      'volume', true),
  ('gr',   'Gramo',      'Gram',       'weight', true),
  ('kg',   'Kilogramo',  'Kilogram',   'weight', true),
  ('m',    'Metro',      'Meter',      'length', true),
  ('cm',   'Centímetro', 'Centimeter', 'length', true),
  ('oz',   'Onza',       'Ounce',      'weight', true),
  ('lb',   'Libra',      'Pound',      'weight', true)
ON CONFLICT ("code") DO NOTHING;

-- Tabla maestra: la app solo LEE. El grant de escritura le llegó por el
-- ALTER DEFAULT PRIVILEGES de `20260806172006_app_db_user`, así que se revoca
-- explícito — si no, cualquier bug del API podría corromper el catálogo que
-- referencian todos los productos.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sellpoint_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON "units" FROM sellpoint_app;
  END IF;
END
$$;
