-- F11-SITE-LEGAL-02/03/04 — la aceptación de los términos y la baja comercial.
--
-- ⚠️ TODO ESTO NACE DORMIDO. Las tres columnas se quedan en NULL mientras
-- `CURRENT_TERMS_VERSION` (packages/shared/src/terms.ts) valga `null`: los
-- textos legales todavía tienen `[[huecos]]` y una razón social provisional,
-- así que no hay nada que aceptar. La migración va ahora igual —aditiva y sin
-- backfill— porque el día que los textos se publiquen, encender debe ser
-- cambiar UNA línea y desplegar, no correr una migración sobre producción.

-- ── Quién aceptó qué, y cuándo (F11-SITE-LEGAL-02/03) ──────────────────────
--
-- Se guarda la VERSIÓN aceptada y no un booleano: «aceptó» sin decir QUÉ
-- aceptó no prueba nada el día que el texto cambie. Con la versión, corregir
-- el aviso es poner una fecha nueva en la constante y todo el mundo lo vuelve
-- a aceptar; con un booleano habría que borrar una columna a mano.
--
-- NULL en las dos = nunca aceptó. Es el estado de TODOS los usuarios de hoy,
-- y por eso no hay backfill: inventar una aceptación que nadie dio sería
-- justo la mentira que estas columnas existen para evitar.
ALTER TABLE "users"
  ADD COLUMN "terms_version"     varchar(32),
  ADD COLUMN "terms_accepted_at" timestamptz(6);

-- Las dos viajan juntas o no viaja ninguna: una fecha sin versión no dice qué
-- se aceptó, y una versión sin fecha no dice cuándo. Cualquiera de las dos
-- sola es un registro que no sirve como prueba, que es su único propósito.
ALTER TABLE "users"
  ADD CONSTRAINT "users_terms_acceptance_check"
    CHECK (("terms_version" IS NULL) = ("terms_accepted_at" IS NULL));

-- ── La baja de los correos comerciales (F11-SITE-LEGAL-04) ─────────────────
--
-- Vive en `site_leads` y no en una tabla propia de bajas porque hoy el ÚNICO
-- correo comercial que existe es la respuesta automática al prospecto del
-- sitio: la baja se pide desde ese correo y aplica a ese correo. El día que
-- haya boletines o campañas, esto se muda a su tabla con el correo como
-- llave — y esta columna es la fuente del backfill.
--
-- NULL = sigue aceptando correos comerciales. Los TRANSACCIONALES (verificar
-- la cuenta, restablecer la contraseña, avisos de cobro) no miran esta
-- columna y no deben: nadie puede darse de baja de que le avisen que su
-- servicio vence.
ALTER TABLE "site_leads"
  ADD COLUMN "unsubscribed_at" timestamptz(6);
