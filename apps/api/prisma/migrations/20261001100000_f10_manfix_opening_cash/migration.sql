-- F10-MANFIX-10 — el FONDO INICIAL del turno: el efectivo con que el cajón
-- arranca para dar cambio.
--
-- Hasta hoy el arqueo esperaba ventas en efectivo − gastos del cajón, y un
-- cajón que abría con $500 de cambio salía sobrando $500 cada día si el
-- cajero no los restaba a mano (el capítulo 5 del manual lo decía como aviso).
-- Decisión de Carlos (2026-09-24): el fondo se ESCRIBE AL ABRIR el turno, y el
-- esperado pasa a ser fondo + ventas en efectivo − gastos del cajón. La cuenta
-- vive en el API (`efectivoEsperado`); esta columna es el dato del turno.
--
-- ── Aditiva y sin romper a nadie al desplegar ─────────────────────────────
--
-- NOT NULL con DEFAULT 0: en Postgres 11+ agregar una columna con un default
-- CONSTANTE no reescribe la tabla, solo anota el valor en el catálogo. Los
-- turnos que estén abiertos al desplegar quedan con fondo $0, que es
-- exactamente lo que el arqueo les esperaba cuando los abrieron; los cerrados
-- ya guardaron su `calculated_cash`, que no se recalcula.
--
-- DECIMAL(14,2) como los demás importes del turno, con el tope de
-- `MONEY_MAX` en el DTO. El CHECK es el cinturón de la base: un cajón no
-- empieza debiendo.
ALTER TABLE "cashbox_sessions"
  ADD COLUMN "opening_cash" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "cashbox_sessions" ADD CONSTRAINT "cashbox_sessions_opening_cash_non_negative"
  CHECK ("opening_cash" >= 0);
