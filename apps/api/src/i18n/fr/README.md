# `fr` — el francés del API, y por qué está casi vacío

Este directorio **NO es un idioma de la aplicación**. `SUPPORTED_LOCALES`
(`packages/shared/src/i18n.ts`) sigue siendo `["es", "en"]`, y el francés se
anuncia en `/fr-ca/` del sitio público como «bientôt».

Existe por UNA sola razón: **F11-SITE-LEAD-05**, la respuesta automática al
prospecto que escribió desde `sellpointy.com`. Esa persona todavía no tiene
cuenta, escribió en francés y contestarle en español sería grosero.

Por eso aquí solo vive `emails.json`, y solo con las claves de esa plantilla
(`siteLeadReply`) más el `linkFallback` que el renderizador necesita. Cualquier
otra clave pedida con `lang: "fr"` cae al idioma de respaldo (`es`), que es el
comportamiento normal de nestjs-i18n — y no puede pasar hoy: el resolvedor de
locale de las peticiones nunca devuelve `fr`, el único que pide este idioma es
`SiteLeadsService` al mandar ese correo.

**Si algún día el francés entra a la aplicación**, esto deja de ser un caso
especial: se agrega `fr` a `SUPPORTED_LOCALES`, se traducen los 25 namespaces y
`message-keys.spec.ts` empieza a exigirlos todos. Mientras tanto, no se agregan
archivos sueltos aquí: un idioma a medias es peor que ninguno.

**Los espacios de no separación se escriben COMO CÓDIGO** (` ` fino antes
de `?` y `!`, ` ` antes de `:`), nunca el carácter invisible a pelo — un
carácter que no se ve no se puede revisar en un diff.
