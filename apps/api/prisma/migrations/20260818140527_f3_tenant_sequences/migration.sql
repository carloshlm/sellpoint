-- F3-DB-03 — `tenant_sequences`: el contador de folios, una fila por
-- (tenant, serie).
--
-- Es una TABLA y no un `SEQUENCE` de Postgres, por dos razones:
--
--   1. Un sequence NO se deshace con un ROLLBACK. Cada transacción fallida
--      dejaría un hueco permanente en la numeración, y un folio faltante es
--      justo lo que un auditor pregunta. Acá el incremento es transaccional.
--   2. Un sequence global filtra volumen entre tenants: por el salto entre dos
--      folios consecutivos se estima cuánto opera el vecino.
--
-- Se descartó `MAX(folio)+1`: exige bloquear la tabla de documentos entera
-- para no entregar el mismo número dos veces.
--
-- El precio es un lock de fila que dura hasta el COMMIT. Por eso `nextFolio`
-- se llama en una transacción CORTA propia y no dentro de la del ledger — ver
-- el docblock de `apps/api/src/modules/inventory/folio.ts`.
--
-- RLS llega en F3-DB-04, junto con el resto de las tablas de la fase.

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenant_id","key")
);

-- AddForeignKey
ALTER TABLE "tenant_sequences" ADD CONSTRAINT "tenant_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
