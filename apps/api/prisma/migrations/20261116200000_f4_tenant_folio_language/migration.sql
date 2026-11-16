-- El juego de prefijos de folio de cada negocio (Carlos, 2026-11-16: «el folío
-- no lo define el idioma del usuario sino el idioma principal de un país» —
-- `TUR-000019` en México, `SHF-000019` en Canadá y Estados Unidos).
--
-- NULL hasta el primer folio: `nextFolio` lo fija entonces desde `country` y ya
-- no cambia. El país se elige DESPUÉS de registrarse (paso 1 del onboarding) y
-- se puede editar, así que fijarlo al crear el negocio lo fijaría sin país.

ALTER TABLE "tenants" ADD COLUMN "folio_language" CHAR(2);

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_folio_language_check"
  CHECK ("folio_language" IS NULL OR "folio_language" IN ('es', 'en'));

-- Los negocios que YA emitieron algún folio lo emitieron en español: quedan
-- fijos en español, aunque su país diga otra cosa, para que su serie no
-- mezcle prefijos. Los que no han emitido ninguno se fijan en su primer folio.
-- (`sale_barcode:…` y `reception_turn:…` también viven en `tenant_sequences`,
-- pero no son folios.)
UPDATE "tenants" t
SET "folio_language" = 'es'
WHERE EXISTS (
  SELECT 1
  FROM "tenant_sequences" s
  WHERE s."tenant_id" = t."id"
    AND s."key" IN (
      'entry', 'exit', 'physical_count', 'sale', 'quote', 'medical_record',
      'medical_order', 'expense', 'purchase', 'purchase_order',
      'purchase_receipt', 'cashbox_session'
    )
);

-- La orden médica cobrada lleva el folio de su cotización: `COT-` en español,
-- `QTE-` en inglés. La regla sigue siendo la misma — el prefijo no miente:
-- prefijo de cotización ⇔ hay cotización.
ALTER TABLE "medical_clinic_orders" DROP CONSTRAINT "medical_clinic_orders_folio_quote_coherent";
ALTER TABLE "medical_clinic_orders"
  ADD CONSTRAINT "medical_clinic_orders_folio_quote_coherent"
  CHECK (("folio" LIKE 'COT-%' OR "folio" LIKE 'QTE-%') = ("quote_id" IS NOT NULL));
