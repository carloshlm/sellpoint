# `site` — el sitio público `sellpointy.com` visto desde el API

El sitio es un Astro estático (`apps/site`) servido por `nginx-edge`. Este
módulo es todo lo que necesita del API: el formulario de interés, la medición
propia y lo que el backoffice ve de ambos.

## Las dos tablas NO llevan `tenant_id` ni RLS

`purge_tenant(uuid)` recorre `information_schema` y borra de **toda** tabla que
tenga una columna llamada `tenant_id`. Un prospecto todavía no es un negocio:
eliminar un cliente no puede llevarse por delante la lista de quién nos
escribió. Tampoco hay contra qué aislar — el único que las lee es el backoffice
de la plataforma.

`site-schema.integration.spec.ts` ejecuta la purga **de verdad** y además
comprueba que ninguna de las dos tablas tenga esa columna. Si algún día alguien
quiere «relacionar el prospecto con el negocio que abrió», ese test se pone rojo
antes que el daño.

## Los dos endpoints públicos

| | `POST /public/leads` | `POST /public/site-events` |
|---|---|---|
| Respuesta | `202 { received: true }` | `202 { received: true }` |
| Cuerpo mal formado | **400** (el formulario lo pinta) | **202** (el beacon no lo leería) |
| Límite por IP | 5 / hora | 120 / minuto |
| `Content-Type` | `application/json` | `text/plain` **o** `application/json` |

### Por qué el beacon va en `text/plain`

`navigator.sendBeacon` puede mandar un `Blob` con `type: "application/json"`,
pero eso convierte la petición en **no simple** y dispara *preflight* CORS. El
preflight es una petición aparte, y el momento típico de un beacon es la página
cerrándose: ahí el `OPTIONS` puede no completarse y el evento se pierde en
silencio.

**El sitio debe mandar:**

```js
navigator.sendBeacon(
  `${API}/public/site-events`,
  new Blob([JSON.stringify(evento)], { type: "text/plain;charset=UTF-8" }),
);
```

Petición simple, cero preflight. `application/json` también funciona (lo parsea
Express), pero no es el camino recomendado.

El precio es `SiteBeaconBodyMiddleware`, montado **solo** en esa ruta: el parser
de JSON de Express ignora `text/plain`, así que alguien tiene que leer el cuerpo.

### Contra el spam, sin captcha

Tres capas, ninguna visible para una persona:

1. **La trampa** (`website`): un campo que nadie ve y un robot llena.
2. **El reloj** (`elapsedMs`): menos de `SITE_LEAD_MIN_ELAPSED_MS` (3 s) entre
   cargar y enviar no lo hace una persona.
3. **El límite por IP**, con el `Throttler` que ya existe.

Las dos primeras **no** responden 400: eso le enseñaría al robot qué corregir.
Se descartan con el mismo 202 y se registra un log **sin datos personales**.

Un captcha se agrega el día que esto no alcance. Hoy le costaría conversiones a
gente real para frenar un problema que todavía no existe.

## Guardar primero, avisar después

`SiteLeadsService` escribe la fila y **luego** manda el correo. Si el proveedor
falla, el prospecto ya está en la base con `notified_at` en NULL, el error va al
log y a Sentry, y la respuesta sigue siendo 202. La lista del backoffice pinta
ese NULL como «sin avisar»: es la red para el día que un correo no llegue.

El aviso va a `PLATFORM_NOTIFY_EMAILS` (y, si está vacía, a `BILLING_ADMIN_EMAILS`) —la misma lista que usa «escríbenos para
activar tu plan»— con **`Reply-To` al correo del prospecto**. No hay variable
nueva ni dirección escrita en el código.

## El francés

`site-lead-reply` se manda en el idioma del prospecto, que puede ser `fr`. Ese
idioma **no** es de la aplicación: `src/i18n/fr/` solo tiene `emails.json` con
esa plantilla. Ver `src/i18n/fr/README.md`.

## CORS

El sitio es otro origen. Va en `CORS_ORIGINS` como cualquier otro, y el acotado
por ruta vive en `common/http/cors.ts`: `/public/*` se sirve **sin
credenciales** y solo con `POST`/`OPTIONS`, así que un origen del sitio no puede
hacer peticiones con cookies contra `/auth/*`.

## Retención: 24 meses

`SiteLeadsRetentionJob` borra lo que tenga más de `SITE_LEADS_RETENTION_MONTHS`
y cuyo correo **no** tenga ya una cuenta. Esa segunda condición pasa por
`auth_resolve_tenant_by_email` (SECURITY DEFINER) y no por un `NOT EXISTS`
contra `users`: esa tabla tiene RLS, y sin contexto de tenant el runtime ve cero
usuarios — un `NOT EXISTS` directo borraría los prospectos de todos los
clientes.

No cuelga de `BillingDailyJob`: ese job tiene escrita en su cabecera la regla
«SOLO DEGRADA» planes, y un borrado de prospectos se la rompería. Lo que sí se
calca es su forma: lógica pura + registrador aparte con su bandera de entorno
(`SITE_LEADS_RETENTION_ENABLED`, apagada por default) + endpoint manual
(`POST /admin/site/leads/retention/run`).

Se registra **cuántos** se borraron, nunca quiénes.
