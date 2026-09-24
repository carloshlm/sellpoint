-- F10-MANFIX-15 — con cuánto pagó el cliente una venta en EFECTIVO.
--
-- El ticket ya sabía imprimir «Recibido» y «Cambio» (el renderer y las
-- traducciones los traían desde F4-TICKET-01), pero el servicio los mandaba en
-- null a propósito: la venta registraba qué se cobró y no con qué billete se
-- pagó, así que lo recibido solo vivía en la pantalla del cobro y se perdía al
-- reimprimir. Decisión de Carlos (2026-09-24): SE GUARDA.
--
-- ── Nula a propósito, y aditiva ───────────────────────────────────────────
--
-- NULL en tarjeta y transferencia, que se cobran por el monto exacto fuera
-- del sistema, y en todas las ventas anteriores a esta columna: no se
-- rellenan, porque cualquier número sería inventado. El ticket omite las dos
-- líneas cuando no hay dato. Una columna nullable sin default no reescribe la
-- tabla: es solo catálogo, sin importar cuántas ventas tenga.
--
-- ── El CHECK es la forma del dato ─────────────────────────────────────────
--
-- Lo recibido existe solo en efectivo y nunca es menos que el total: pagar de
-- menos no es un pago, y el cambio saldría negativo. El API ya lo valida
-- (422 `pos.cash_received_below_total`, 400 fuera de efectivo); el CHECK es el
-- cinturón para lo que no pase por el API, igual que `sales_amounts_non_negative`.
-- Al agregarlo, Postgres lo comprueba contra las ventas que ya existen: todas
-- traen NULL en la columna recién nacida, así que ninguna lo viola.
ALTER TABLE "sales"
  ADD COLUMN "cash_received" DECIMAL(14,2);

ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_received_coherent"
  CHECK (
    "cash_received" IS NULL
    OR ("payment_method" = 'cash' AND "cash_received" >= "total")
  );
