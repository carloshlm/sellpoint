-- F3-DOC-01 — `inventory_documents` e `inventory_document_lines`: el
-- encabezado de toda operación que toca stock, y lo que el usuario capturó.
--
-- ── Sobre el DROP de `batch_id` y `transfer_id` ──────────────────────────
--
-- Los dos son datos de CABECERA y ahora viven en el documento; tenerlos
-- repetidos en cada línea era la misma verdad escrita dos veces. El
-- `ADD COLUMN document_id NOT NULL` **falla si la tabla tiene filas**, y eso
-- es deliberado: preferimos que la migración se caiga a inventar un documento
-- contenedor para movimientos huérfanos.
--
-- Se verificó antes de escribirla que `stock_movements` está VACÍA en todos
-- los entornos, y no por confianza: **no existe un solo escritor**. El módulo
-- `inventory` todavía no está construido y ningún service llama a
-- `stockMovement.create` — solo lo hacen los tests de integración. La tabla
-- nació en F3-DB-01 (2026-08-18) y este cambio llega el mismo día, que es
-- exactamente por qué se priorizó hacerlo ahora.
--
-- ── Sobre el trigger que falta ───────────────────────────────────────────
--
-- `inventory_documents` NO puede blindarse con `REVOKE UPDATE, DELETE` como
-- `stock_movements`: un borrador se edita hasta que se confirma. La
-- inmutabilidad de lo confirmado la impone un trigger, y llega en F3-DOC-02.
-- RLS para las dos tablas llega en F3-DB-04.

/*
  Warnings:

  - You are about to drop the column `batch_id` on the `stock_movements` table. All the data in the column will be lost.
  - You are about to drop the column `transfer_id` on the `stock_movements` table. All the data in the column will be lost.
  - Added the required column `document_id` to the `stock_movements` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "InventoryDocumentType" AS ENUM ('entry', 'exit', 'physical_count');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('draft', 'confirmed', 'canceled');

-- DropIndex
DROP INDEX "stock_movements_tenant_id_batch_id_idx";

-- AlterTable
ALTER TABLE "stock_movements" DROP COLUMN "batch_id",
DROP COLUMN "transfer_id",
ADD COLUMN     "document_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "inventory_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "folio" VARCHAR(20) NOT NULL,
    "type" "InventoryDocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'draft',
    "warehouse_id" UUID NOT NULL,
    "linked_warehouse_id" UUID,
    "reason_code" "MovementReason",
    "reference" VARCHAR(120),
    "reason_note" TEXT,
    "authorized_by" UUID,
    "transfer_id" UUID,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "canceled_by" UUID,
    "canceled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_document_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "presentation_id" UUID,
    "quantity" DECIMAL(14,4),
    "unit_cost" DECIMAL(14,2),
    "lot_code" VARCHAR(64),
    "expires_at" DATE,
    "location" VARCHAR(64),
    "theoretical" DECIMAL(14,4),
    "counted" DECIMAL(14,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_documents_tenant_id_type_status_created_at_idx" ON "inventory_documents"("tenant_id", "type", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_documents_tenant_id_folio_idx" ON "inventory_documents"("tenant_id", "folio");

-- CreateIndex
CREATE INDEX "inventory_documents_tenant_id_warehouse_id_created_at_idx" ON "inventory_documents"("tenant_id", "warehouse_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_documents_tenant_id_created_by_status_idx" ON "inventory_documents"("tenant_id", "created_by", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_documents_tenant_id_folio_key" ON "inventory_documents"("tenant_id", "folio");

-- CreateIndex
CREATE INDEX "inventory_document_lines_product_id_idx" ON "inventory_document_lines"("product_id");

-- CreateIndex
CREATE INDEX "inventory_document_lines_tenant_id_idx" ON "inventory_document_lines"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_document_lines_document_id_line_no_key" ON "inventory_document_lines"("document_id", "line_no");

-- CreateIndex
CREATE INDEX "stock_movements_document_id_idx" ON "stock_movements"("document_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_linked_warehouse_id_fkey" FOREIGN KEY ("linked_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_authorized_by_fkey" FOREIGN KEY ("authorized_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_canceled_by_fkey" FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Un traspaso tiene a lo sumo un despacho y una recepción
-- ─────────────────────────────────────────────────────────────────────────
--
-- ÚNICO y PARCIAL: la enorme mayoría de los documentos no son de traspaso, y
-- sin el `WHERE` el índice trataría a todos los NULL como colisiones y solo
-- dejaría UN documento sin traspaso en toda la tabla (el mismo gotcha que el
-- unique parcial de `barcode` en F2).
--
-- Con tres tipos, esto significa: un `exit` (el despacho) y un `entry` (la
-- recepción) por traspaso. No hace falta un guard en el service.
CREATE UNIQUE INDEX "inventory_documents_transfer_id_type_key"
  ON "inventory_documents" ("transfer_id", "type")
  WHERE "transfer_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- CHECKs del ciclo de vida
-- ─────────────────────────────────────────────────────────────────────────

-- Confirmar deja rastro de quién y cuándo, siempre. Equivalencia y no
-- implicación: también rechaza un borrador que ya trae fecha de confirmación.
ALTER TABLE "inventory_documents"
  ADD CONSTRAINT "inventory_documents_confirmed_check"
  CHECK (("status" = 'confirmed') = ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL));

-- Anular también deja rastro. `canceled_by` no se exige: un borrador puede
-- anularse por una limpieza automática futura, y ahí no hay una persona.
ALTER TABLE "inventory_documents"
  ADD CONSTRAINT "inventory_documents_canceled_check"
  CHECK (("status" = 'canceled') = ("canceled_at" IS NOT NULL));

-- El motivo se ELIGE dentro del borrador, así que puede faltar mientras se
-- carga. Pero un documento confirmado sin motivo no se puede leer en el kardex
-- ni imprimir: ahí ya es obligatorio.
ALTER TABLE "inventory_documents"
  ADD CONSTRAINT "inventory_documents_reason_on_confirm_check"
  CHECK ("status" <> 'confirmed' OR "reason_code" IS NOT NULL);

-- El almacén enlazado, si viene, es OTRO almacén.
ALTER TABLE "inventory_documents"
  ADD CONSTRAINT "inventory_documents_linked_warehouse_check"
  CHECK ("linked_warehouse_id" IS DISTINCT FROM "warehouse_id");

-- La numeración de líneas arranca en 1: `line_no` es lo que el usuario ve en
-- el papel, no un índice de array.
ALTER TABLE "inventory_document_lines"
  ADD CONSTRAINT "inventory_document_lines_line_no_check"
  CHECK ("line_no" >= 1);
