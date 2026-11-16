-- El folio del turno de caja: `TUR-000001`, por negocio (Carlos, 2026-11-16:
-- «un folio de cierre de turno para encontrarlo más fácilmente en los
-- reportes»). Lo toma el turno al ABRIR, de la serie `cashbox_session` de
-- `tenant_sequences`, igual que las ventas toman `VTA`.
--
-- Los turnos que ya existen lo reciben en el orden en que se ABRIERON (con el
-- id de desempate, como la migración de los códigos de sucursal) y la serie
-- queda en el último número usado: el siguiente turno sigue la cuenta sin
-- chocar. Llena la columna nueva; no cambia ningún dato que ya existiera.

ALTER TABLE "cashbox_sessions" ADD COLUMN "folio" VARCHAR(32);

WITH numerados AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "tenant_id" ORDER BY "opened_at", "id") AS n
  FROM "cashbox_sessions"
)
UPDATE "cashbox_sessions" s
SET "folio" = 'TUR-' || lpad(numerados.n::text, 6, '0')
FROM numerados
WHERE s."id" = numerados."id";

-- La serie arranca donde terminó el relleno. `next_value` guarda el ÚLTIMO
-- número usado (`nextSequenceValue` suma 1 y devuelve el nuevo). GREATEST por
-- si algún negocio ya tuviera la fila: nunca se retrocede una serie.
--
-- Solo los negocios que EXISTEN: una purga que borró el negocio con las llaves
-- apagadas puede dejar turnos sueltos, y su serie violaría la llave de
-- `tenant_sequences` (pasó en la base de pruebas). Esos turnos igual reciben su
-- folio arriba; serie no necesitan, nadie va a abrir otro.
INSERT INTO "tenant_sequences" ("tenant_id", "key", "next_value", "updated_at")
SELECT s."tenant_id", 'cashbox_session', count(*), now()
FROM "cashbox_sessions" s
JOIN "tenants" t ON t."id" = s."tenant_id"
GROUP BY s."tenant_id"
ON CONFLICT ("tenant_id", "key")
DO UPDATE SET "next_value" = GREATEST("tenant_sequences"."next_value", EXCLUDED."next_value"),
              "updated_at" = now();

ALTER TABLE "cashbox_sessions" ALTER COLUMN "folio" SET NOT NULL;

-- Un RESPALDO, no la regla: el API nuevo siempre pone el folio de la serie.
-- Mientras corre el deploy (la migración va antes que el contenedor nuevo) o
-- si el deploy regresa a la versión anterior, el API viejo abre turnos sin
-- folio; sin este valor la caja no podría abrir turno. Esos turnos quedan con
-- un folio «PEND-…» que se reconoce a simple vista.
ALTER TABLE "cashbox_sessions"
  ALTER COLUMN "folio" SET DEFAULT ('PEND-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

CREATE UNIQUE INDEX "cashbox_sessions_tenant_id_folio_key" ON "cashbox_sessions"("tenant_id", "folio");
