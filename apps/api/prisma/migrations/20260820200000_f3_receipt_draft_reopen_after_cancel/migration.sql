-- ─────────────────────────────────────────────────────────────────────────
-- Anular una recepción dejaba el traspaso imposible de recibir. PARA SIEMPRE.
-- ─────────────────────────────────────────────────────────────────────────
--
-- El índice parcial de F3-DOC-01 decía "un despacho y una recepción por
-- traspaso", y estaba bien — pero se escribió sin excluir los ANULADOS, así
-- que en la práctica decía "una recepción POR TRASPASO EN TODA SU HISTORIA".
--
-- El callejón sin salida es real y Carlos lo pisó en producción (SAL-000002):
-- anuló ENT-000002 esperando poder recibir de nuevo, y el traspaso quedó con
-- su única recepción posible ya gastada en un documento muerto. No había forma
-- de salir sin tocar la base.
--
-- Un documento anulado es HISTORIA, no un ocupante del lugar. En el resto del
-- sistema anular es justamente la manera de volver a empezar sin borrar el
-- rastro —el folio se queda con el anulado, la serie no pierde números—, y no
-- había razón para que acá significara lo contrario.
--
-- La invariante que sí importa se conserva: **a lo sumo una recepción VIVA por
-- traspaso**. Dos personas recibiendo a la vez siguen chocando contra el
-- índice, que es para lo que se puso.
DROP INDEX "inventory_documents_transfer_id_type_key";

CREATE UNIQUE INDEX "inventory_documents_transfer_id_type_key"
  ON "inventory_documents" ("transfer_id", "type")
  WHERE "transfer_id" IS NOT NULL AND "status" <> 'canceled';
