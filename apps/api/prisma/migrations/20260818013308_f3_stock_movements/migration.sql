-- F3-DB-01 — `stock_movements`: el libro mayor del inventario.
--
-- Todo lo que sigue al bloque generado por Prisma es lo que Prisma NO expresa
-- en el schema y que, por lo mismo, solo vive acá: IDENTITY, UNIQUE sobre
-- `seq`, los CHECK de coherencia y el índice parcial de `transfer_id`. Lo
-- cubre `inventory-schema.integration.spec.ts` para que un `migrate dev`
-- distraído no se los lleve en silencio (mismo riesgo asumido en F2 con el
-- UNIQUE parcial de barcode).
--
-- `created_at` usa `transaction_timestamp()` y no el `now()` que pondría
-- Prisma: con `@default(now())` el timestamp lo genera el CLIENTE y viaja en
-- el INSERT, así que la hora del asiento sería la de un reloj de aplicación
-- (no sincronizado entre instancias, y capaz de ir para atrás con NTP).
--
-- `seq` va GENERATED ALWAYS AS IDENTITY y no BIGSERIAL (que es lo que genera
-- Prisma para `@default(autoincrement())`): con BIGSERIAL cualquier INSERT
-- puede elegir su propio número y el desempate cronológico del kardex deja de
-- ser confiable. `ALWAYS` lo prohíbe a nivel de motor.
--
-- RLS, FORCE y el REVOKE de UPDATE/DELETE que hacen la tabla append-only de
-- verdad llegan en F3-DB-04, junto con las otras tres tablas de la fase.

-- CreateEnum
CREATE TYPE "MovementDirection" AS ENUM ('entry', 'exit');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('invoice', 'adjustment', 'transfer', 'customer_return', 'sale', 'sale_return', 'loss', 'consumption', 'expired', 'physical_count');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGINT GENERATED ALWAYS AS IDENTITY,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "presentation_id" UUID,
    "parent_product_id" UUID,
    "direction" "MovementDirection" NOT NULL,
    "reason_code" "MovementReason" NOT NULL,
    "reason_note" TEXT,
    "reference" VARCHAR(120),
    "authorized_by" UUID,
    "linked_warehouse_id" UUID,
    "transfer_id" UUID,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_product_id_created_at_seq_idx" ON "stock_movements"("tenant_id", "product_id", "created_at" DESC, "seq" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_warehouse_id_created_at_idx" ON "stock_movements"("tenant_id", "warehouse_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_batch_id_idx" ON "stock_movements"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "stock_movements_presentation_id_idx" ON "stock_movements"("presentation_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_linked_warehouse_id_fkey" FOREIGN KEY ("linked_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_authorized_by_fkey" FOREIGN KEY ("authorized_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- `seq` es la clave de desempate del kardex: tiene que ser única
-- ─────────────────────────────────────────────────────────────────────────
--
-- Como índice único (no como CONSTRAINT) y con el nombre que usa Prisma,
-- porque el `@unique` del schema lo declara: si acá tuviera otra forma u otro
-- nombre, `migrate diff` reportaría drift para siempre.
CREATE UNIQUE INDEX "stock_movements_seq_key" ON "stock_movements"("seq");

-- ─────────────────────────────────────────────────────────────────────────
-- Índice parcial de traspasos
-- ─────────────────────────────────────────────────────────────────────────
--
-- Parcial a propósito: la enorme mayoría de los movimientos NO son traspasos,
-- y un índice completo indexaría millones de NULL para servir consultas que
-- siempre preguntan por un `transfer_id` concreto. La FK a `transfers` se
-- agrega en F3-DB-02, cuando esa tabla existe.
CREATE INDEX "stock_movements_transfer_id_idx"
  ON "stock_movements" ("transfer_id")
  WHERE "transfer_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- CHECKs de coherencia — la red, no el guard
-- ─────────────────────────────────────────────────────────────────────────
--
-- El guard con mensaje claro para el usuario vive en `StockLedgerService`
-- (F3-CORE-05). Esto es lo que hace IMPOSIBLE corromper el libro mayor aunque
-- ese service tenga un bug, alguien escriba por consola o una migración futura
-- se equivoque. En una tabla append-only el dato malo no se corrige: se queda.

-- La cantidad SIEMPRE es positiva y SIEMPRE está en la unidad base. El signo
-- lo pone `direction` — permitir cantidades negativas daría dos formas de
-- expresar lo mismo y ninguna consulta podría confiar en `SUM(quantity)`.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_check" CHECK ("quantity" > 0);

-- Un costo negativo no existe. Nulo sí: solo las entradas por factura lo
-- exigen (regla del service); un ajuste o una merma no tienen precio de compra.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_unit_cost_check"
  CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

-- Dirección × motivo: la mitad de las 20 combinaciones posibles son
-- imposibles en el negocio. Una "entrada por merma" o una "salida por factura
-- de compra" son errores de programación, no estados del inventario.
--
-- `sale` y `sale_return` están reservados para el POS de F4: el CHECK ya los
-- ubica del lado correcto para que F4 no necesite tocar el schema.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_direction_reason_check" CHECK (
    ("direction" = 'entry' AND "reason_code" IN (
      'invoice', 'adjustment', 'transfer', 'customer_return', 'sale_return', 'physical_count'
    ))
    OR
    ("direction" = 'exit' AND "reason_code" IN (
      'adjustment', 'transfer', 'sale', 'loss', 'consumption', 'expired', 'physical_count'
    ))
  );

-- El motivo y la contraparte van juntos, en los DOS sentidos: un traspaso sin
-- el otro almacén no se puede reconstruir, y un almacén enlazado en un ajuste
-- es basura que confundiría al kardex. Por eso es una equivalencia (`=`) entre
-- dos booleanos y no dos CHECKs sueltos.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_transfer_link_check"
  CHECK (("reason_code" = 'transfer') = ("linked_warehouse_id" IS NOT NULL));

-- Un traspaso a uno mismo no mueve nada. `IS DISTINCT FROM` y no `<>` porque
-- `<>` con NULL da NULL, que el CHECK trata como válido y dejaría pasar la
-- fila (el clásico agujero de los CHECK con columnas nullable).
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_linked_warehouse_check"
  CHECK ("linked_warehouse_id" IS DISTINCT FROM "warehouse_id");
