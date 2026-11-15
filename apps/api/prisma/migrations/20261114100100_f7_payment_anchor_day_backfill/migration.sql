-- El ancla del ÚLTIMO pago vivo de cada suscripción (verificación del
-- 2026-11-14).
--
-- `anchor_day` nació vacío en todos los pagos de antes. Sin este relleno, anular
-- el primer acuerdo de un negocio —que mueve el ancla al día acordado— no tenía
-- de dónde devolverla: el pago anterior decía NULL y el ancla se quedaba en el
-- día del acuerdo, así que el siguiente pago mensual cubría mes y medio.
--
-- Solo el más reciente: es el único del que `voidPayment` toma el ancla, y el
-- de la suscripción es exactamente el que ese pago dejó (el ancla solo cambia
-- con un pago o con el PATCH del backoffice, que también es el vigente). Llena
-- la columna nueva; no reescribe ningún dato que ya existiera.

UPDATE "subscription_payments" p
SET "anchor_day" = s."anchor_day"
FROM "tenant_subscriptions" s
WHERE p."subscription_id" = s."id"
  AND p."anchor_day" IS NULL
  AND s."anchor_day" IS NOT NULL
  AND p."id" = (
    SELECT q."id"
    FROM "subscription_payments" q
    WHERE q."subscription_id" = s."id"
      AND q."status" = 'recorded'
    ORDER BY q."period_end" DESC, q."paid_at" DESC, q."id" DESC
    LIMIT 1
  );
