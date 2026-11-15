-- El día de cobro que dejó cada pago (Carlos, 2026-11-14).
--
-- Un pago con «Cubre hasta» acordado mueve el ancla al día de esa fecha. Para
-- que ANULARLO devuelva el día de cobro anterior, cada pago guarda el ancla
-- que dejó: `voidPayment` la toma del pago vivo más reciente. Sin esto, el
-- siguiente pago mensual tras anular un acuerdo cubría mes y medio
-- (`addBillingPeriod` toma el año y el mes de la fecha anterior y el día del
-- ancla).
--
-- Aditiva: los pagos de antes quedan en NULL y, al anularlos, el ancla de la
-- suscripción no se toca (lo de siempre).

ALTER TABLE "subscription_payments" ADD COLUMN "anchor_day" SMALLINT;

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_anchor_day_check"
  CHECK ("anchor_day" IS NULL OR ("anchor_day" BETWEEN 1 AND 31));
