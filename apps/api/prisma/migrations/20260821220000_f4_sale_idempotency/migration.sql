-- F4-SALE-02 — que el doble tap del cajero no cobre dos veces.
--
-- El botón COBRAR tarda: la transacción bloquea saldos, reparte FEFO y asienta
-- movimientos. En una tablet lenta, medio segundo sin respuesta invita a
-- volver a tocar — y sin esto, el segundo toque es una SEGUNDA venta con su
-- folio, su stock descontado y su fila en el arqueo.
--
-- La clave la genera el CLIENTE al abrir el modal de cobro, no el servidor: si
-- la generara el servidor por request, dos requests tendrían dos claves y no
-- habría nada que comparar. Es el mismo criterio que usan las pasarelas de
-- pago.
--
-- UNIQUE por TENANT y no global: dos negocios distintos pueden generar la
-- misma clave sin que a ninguno le importe, y un unique global los haría
-- colisionar entre sí — un bug de aislamiento disfrazado de bug de negocio.
ALTER TABLE "sales" ADD COLUMN "idempotency_key" VARCHAR(120);

CREATE UNIQUE INDEX "sales_tenant_idempotency_key"
  ON "sales" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
