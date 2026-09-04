-- F9-CLINIC — el nombre de los turnos que el consultorio ligó a medias.
--
-- Iniciar una consulta desde un turno SIN cliente da de alta al paciente y le
-- pone `customer_id` al turno. Pero la lista de Recepción no pinta el cliente
-- vinculado: pinta el SNAPSHOT `customer_name`, el que sobrevive a un borrado
-- del cliente. Como esa columna se quedó en NULL, la pantalla siguió diciendo
-- «Sin cliente» para pacientes que ya estaban adentro del consultorio.
--
-- El código ya escribe las dos columnas juntas (`records.service.ts`); esto es
-- para las filas que nacieron torcidas. Es idempotente: solo toca las que
-- tienen cliente y no tienen nombre, así que volver a correrla no hace nada.
--
-- Un turno cuyo cliente fue BORRADO conserva `customer_id` en NULL por el
-- `ON DELETE SET NULL`, y por eso no entra acá: su nombre ya no se puede
-- reconstruir, que es exactamente el caso para el que existe el snapshot.

UPDATE "reception_turns" t
   SET "customer_name" = left(
         btrim(concat_ws(' ', c."first_name", c."last_name_paternal", c."last_name_maternal")),
         200
       )
  FROM "customers" c
 WHERE c."id" = t."customer_id"
   AND c."tenant_id" = t."tenant_id"
   AND t."customer_id" IS NOT NULL
   AND t."customer_name" IS NULL;
