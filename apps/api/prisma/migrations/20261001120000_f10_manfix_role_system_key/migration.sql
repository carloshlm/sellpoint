-- F10-MANFIX-22 — los roles de fábrica con una llave fija y su nombre en el
-- idioma del negocio (decisión de Carlos, 2026-09-24).
--
-- Los cuatro roles con los que nace todo negocio se llamaban Admin, Manager,
-- Seller y Viewer, en inglés, también en un negocio que opera en español. Y el
-- nombre era además su IDENTIDAD: 11 migraciones de permisos buscan
-- `WHERE r.name = 'Viewer'`, así que un negocio que renombraba un rol lo
-- dejaba fuera de los permisos siguientes sin enterarse. Desde aquí:
--
--   clave    español        inglés
--   admin    Administrador  Admin
--   manager  Encargado      Manager
--   seller   Cajero         Cashier
--   viewer   Consulta       Viewer
--
-- La CLAVE es fija y sobrevive a un renombre, y el NOMBRE es un dato que el
-- negocio edita. Una migración de permisos futura busca `r.system_key`, nunca
-- `r.name` (convención en `role-catalog.ts` y ARQUITECTURA § 5.2). Las 11
-- anteriores no se tocan: ya corrieron en todas las bases que existían, y en
-- una base nueva no insertan nada porque todavía no hay roles.
--
-- Todo es SQL de conjunto (sin bloques DO): cada sentencia termina en punto y
-- coma al final de su línea y `roles-schema.integration.spec.ts` reproduce las
-- de datos una por una. Idempotente: la segunda corrida no encuentra nada que
-- hacer.

-- ── 1) La columna ─────────────────────────────────────────────────────────
--
-- Nula a propósito: NULL es un rol PERSONALIZADO. Una columna nullable sin
-- default no reescribe la tabla. El CHECK admite solo las cuatro claves de
-- `TENANT_ROLES` (un NULL pasa, como en todo CHECK), y el índice único
-- parcial —mismo molde que `catalogs_tenant_id_system_key_key`— garantiza que
-- un negocio tenga a lo sumo un rol de cada clave. Prisma no expresa ninguno
-- de los dos: viven aquí.
ALTER TABLE "roles" ADD COLUMN "system_key" TEXT;

ALTER TABLE "roles" ADD CONSTRAINT "roles_system_key_check"
  CHECK ("system_key" IN ('admin', 'manager', 'seller', 'viewer'));

CREATE UNIQUE INDEX "roles_tenant_id_system_key_key"
  ON "roles" ("tenant_id", "system_key")
  WHERE "system_key" IS NOT NULL;

-- ── 2) La clave de los roles de fábrica que ya existen ────────────────────
--
-- Un rol es de fábrica si lo creó `provision()`: el ÚNICO camino por el que un
-- negocio crea un rol propio es `POST /roles`, y `RolesService` deja siempre
-- un `role.created` en la auditoría. Su clave sale del nombre con el que
-- NACIÓ: el de antes de su primer renombre auditado (`role.updated` que cambió
-- el nombre), o el actual si nunca se renombró. Así un «Seller» que el negocio
-- ya había llamado «Mostrador» también gana su clave. Los nombres viejos
-- `TenantAdmin` y `POS_Seller` cuentan: la guarda del 2026-08-26 los dejó así
-- en los negocios que ya tenían un «Admin» o un «Seller» propio.
--
-- Si dos roles de un negocio reclaman la misma clave gana el más antiguo (el
-- de fábrica nace con el negocio), y en un empate el nombre viejo. El
-- NOT EXISTS respeta al negocio que ya tiene la clave.
WITH auditoria AS MATERIALIZED (
  SELECT a."resource_id", a."action", a."before"->>'name' AS antes, a."created_at", a."id"
  FROM "audit_logs" a
  WHERE a."resource_type" = 'role'
    AND (
      a."action" = 'role.created'
      OR (
        a."action" = 'role.updated'
        AND a."before"->>'name' IS DISTINCT FROM a."after"->>'name'
      )
    )
), origen AS (
  SELECT c."id", c."tenant_id", c."created_at",
         COALESCE(
           (
             SELECT au.antes FROM auditoria au
             WHERE au."resource_id" = c."id"::text AND au."action" = 'role.updated'
             ORDER BY au."created_at", au."id"
             LIMIT 1
           ),
           c."name"
         ) AS nombre_de_nacimiento
  FROM "roles" c
  WHERE c."system_key" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM auditoria au
      WHERE au."resource_id" = c."id"::text AND au."action" = 'role.created'
    )
), elegido AS (
  SELECT DISTINCT ON (o."tenant_id", f.system_key) o."id", f.system_key
  FROM origen o
  JOIN (VALUES
    ('TenantAdmin', 'admin',   0),
    ('Admin',       'admin',   1),
    ('Manager',     'manager', 1),
    ('POS_Seller',  'seller',  0),
    ('Seller',      'seller',  1),
    ('Viewer',      'viewer',  1)
  ) AS f(nombre, system_key, preferencia) ON f.nombre = o.nombre_de_nacimiento
  WHERE NOT EXISTS (
    SELECT 1 FROM "roles" otro
    WHERE otro."tenant_id" = o."tenant_id" AND otro."system_key" = f.system_key
  )
  ORDER BY o."tenant_id", f.system_key, o."created_at", f.preferencia, o."id"
)
UPDATE "roles" r
SET "system_key" = e.system_key
FROM elegido e
WHERE r."id" = e."id";

-- ── 3) El nombre, en el idioma del dueño ─────────────────────────────────
--
-- El negocio no tiene idioma propio: lo tiene cada usuario. El del negocio es
-- el del PRIMER usuario (el dueño, que lo registró y eligió el idioma en el
-- alta), mismo criterio que el backfill de categorías de gasto (F9-EXP-02) y
-- que `provision()`. Sin usuarios, español.
--
-- Solo se renombra lo que sigue EXACTAMENTE con su nombre de fábrica en
-- inglés: un nombre que el negocio eligió se respeta. Y el NOT EXISTS
-- respeta el unique(tenant_id, name): si el negocio ya tiene un rol propio
-- llamado «Cajero», su cajero de fábrica se queda «Seller» (con su clave).
-- Cada renombre queda en `audit_logs` como `role.name_localized`, para que
-- se pueda rastrear qué cambió y por qué (molde de F9-SUPPCAT-02).
WITH destino AS (
  SELECT c."id", c."tenant_id", c."name" AS antes,
         CASE WHEN dueno."locale" = 'en' THEN f.nombre_en ELSE f.nombre_es END AS despues
  FROM "roles" c
  JOIN (VALUES
    ('admin',   'TenantAdmin', 'Administrador', 'Admin'),
    ('admin',   'Admin',       'Administrador', 'Admin'),
    ('manager', 'Manager',     'Encargado',     'Manager'),
    ('seller',  'POS_Seller',  'Cajero',        'Cashier'),
    ('seller',  'Seller',      'Cajero',        'Cashier'),
    ('viewer',  'Viewer',      'Consulta',      'Viewer')
  ) AS f(system_key, de_fabrica, nombre_es, nombre_en)
    ON f.system_key = c."system_key" AND f.de_fabrica = c."name"
  LEFT JOIN LATERAL (
    SELECT u."locale" FROM "users" u
    WHERE u."tenant_id" = c."tenant_id"
    ORDER BY u."created_at", u."id"
    LIMIT 1
  ) dueno ON true
), renombrados AS (
  UPDATE "roles" r
  SET "name" = d.despues
  FROM destino d
  WHERE r."id" = d."id"
    AND d.despues <> d.antes
    AND NOT EXISTS (
      SELECT 1 FROM "roles" otro
      WHERE otro."tenant_id" = d."tenant_id" AND otro."name" = d.despues
    )
  RETURNING r."id", r."tenant_id", d.antes, r."name" AS despues
)
INSERT INTO "audit_logs" ("tenant_id", "action", "resource_type", "resource_id", "before", "after")
SELECT "tenant_id", 'role.name_localized', 'role', "id"::text,
       jsonb_build_object('name', antes), jsonb_build_object('name', despues)
FROM renombrados;
