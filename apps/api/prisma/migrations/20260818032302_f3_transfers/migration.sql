-- F3-DB-02 — `transfers` y `transfer_lines`: el traspaso como PROCESO.
--
-- Todo lo que sigue al bloque generado por Prisma es lo que Prisma NO expresa:
-- los CHECK de coherencia y los índices PARCIALES de `in_transit`. Lo cubre
-- `inventory-schema.integration.spec.ts`, para que un `migrate dev` distraído
-- no se los lleve en silencio (mismo riesgo asumido en F3-DB-01).
--
-- Esta tabla NO lleva folio ni punteros a documentos, y es deliberado:
--   · el folio del traspaso es el de su documento de despacho, que es una
--     Salida con motivo traspaso (decisión del 2026-08-18: el motivo no
--     cambia la serie);
--   · el único enlace documento↔traspaso lo lleva
--     `inventory_documents.transfer_id` (F3-DOC-01). Al revés sería imposible:
--     el documento se confirma DESPUÉS de crear el traspaso, y un documento
--     confirmado ya no admite que le rellenen una columna hacia atrás.
--
-- RLS llega en F3-DB-04 junto con el resto de las tablas de la fase.

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('in_transit', 'completed', 'canceled');

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "origin_warehouse_id" UUID NOT NULL,
    "destination_warehouse_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'in_transit',
    "discrepancy_note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "received_by" UUID,
    "received_at" TIMESTAMPTZ(6),
    "canceled_by" UUID,
    "canceled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_sent" DECIMAL(14,4) NOT NULL,
    "quantity_received" DECIMAL(14,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfers_tenant_id_status_created_at_idx" ON "transfers"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transfer_lines_product_id_idx" ON "transfer_lines"("product_id");

-- CreateIndex
CREATE INDEX "transfer_lines_tenant_id_idx" ON "transfer_lines"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lines_transfer_id_product_id_key" ON "transfer_lines"("transfer_id", "product_id");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_origin_warehouse_id_fkey" FOREIGN KEY ("origin_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_canceled_by_fkey" FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Índices parciales: la vista de tránsito solo mira lo que está en camino
-- ─────────────────────────────────────────────────────────────────────────
--
-- Parciales a propósito: "pendientes de enviar" y "pendientes de recibir"
-- filtran SIEMPRE por `in_transit`. Un índice completo indexaría años de
-- traspasos ya cerrados para servir consultas que nunca los piden.
CREATE INDEX "transfers_origin_warehouse_id_idx"
  ON "transfers" ("origin_warehouse_id")
  WHERE "status" = 'in_transit';

CREATE INDEX "transfers_destination_warehouse_id_idx"
  ON "transfers" ("destination_warehouse_id")
  WHERE "status" = 'in_transit';

-- ─────────────────────────────────────────────────────────────────────────
-- CHECKs de coherencia — la red, no el guard
-- ─────────────────────────────────────────────────────────────────────────

-- Un traspaso a uno mismo no mueve nada.
ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_different_warehouses_check"
  CHECK ("origin_warehouse_id" <> "destination_warehouse_id");

-- El estado y sus campos van juntos, en los DOS sentidos: un `completed` sin
-- quién ni cuándo recibió no se puede auditar, y un `in_transit` CON fecha de
-- recepción es una contradicción. Por eso es una equivalencia entre booleanos
-- y no dos CHECK sueltos.
ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_completed_check"
  CHECK (("status" = 'completed') = ("received_at" IS NOT NULL AND "received_by" IS NOT NULL));

-- Cancelar un traspaso NO devuelve el stock al origen (la salida ya ocurrió y
-- es historia; el reingreso es un `adjustment` explícito). Justamente por eso
-- la justificación es obligatoria: alguien tiene que poder leer, meses
-- después, por qué ese stock se dio por perdido.
ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_canceled_check"
  CHECK (("status" = 'canceled') = ("canceled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL));

-- Una línea que no envía nada no es una línea.
ALTER TABLE "transfer_lines"
  ADD CONSTRAINT "transfer_lines_quantity_sent_check"
  CHECK ("quantity_sent" > 0);

-- Recibir más de lo enviado está BLOQUEADO a propósito: ¿de dónde salió el
-- excedente? El operador lo registra como una Entrada con motivo ajuste, que
-- sí queda explicada. NULL es válido y significa "todavía no se recibió",
-- distinto de 0, que significa "llegó vacía".
ALTER TABLE "transfer_lines"
  ADD CONSTRAINT "transfer_lines_quantity_received_check"
  CHECK ("quantity_received" IS NULL
         OR ("quantity_received" >= 0 AND "quantity_received" <= "quantity_sent"));
