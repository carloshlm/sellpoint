# `pending/` — vhosts escritos y probados, todavía apagados

Esta carpeta guarda configuración de nginx **lista pero deliberadamente no
publicada**. Es el lugar donde vive un vhost cuando el archivo ya está bien y
lo que falta es una decisión o un trámite de fuera del repo.

## Por qué existe

`deploy.yml` copia `nginx/conf.d/` y `nginx/snippets/` **completos** al server
de producción en **cada push a main** (paso «copiar compose, nginx y php-fpm»)
y después corre `nginx -t && nginx -s reload`. Traducido: cualquier archivo que
alguien deje en `conf.d/` **está publicado desde el siguiente push**, sin que
nadie decida nada y sin ventana para arrepentirse.

`pending/` no lo copia nadie. Ni el pipeline, ni `tls-bootstrap.sh`, ni el
compose. Mover un archivo de acá a `conf.d/` **es** el interruptor, y es el
único.

> Es la misma idea que `bootstrap/` (ver su README), pero por un motivo
> distinto: allí falta el certificado, acá falta permiso para publicar.

## Qué hay hoy

| Archivo | Qué sirve | Qué le falta para encenderse |
|---|---|---|
| `sellpointy.com.conf` | El sitio público en el apex | Que los textos legales no tengan huecos (F11-SITE-LEGAL-01) |
| `sitio-sandbox.sellpointy.com.conf` | El mismo sitio, en pruebas | Un registro DNS **y** reemitir el certificado con ese SAN |

Los dos están validados: `nginx -t` pasa con ellos dentro de `conf.d/`, y
`infrastructure/scripts/site-vhost.test.sh` revisa en cada corrida que sigan
cumpliendo su contrato (CSP estricta, `/api/` cerrado salvo `/api/public/`,
redirecciones a la app, `root` en la ruta de dentro del contenedor).

---

## 1. Encender el sitio en el apex

El orden importa. Está pensado para que **no exista un solo minuto** en el que
`sellpointy.com` no responda algo útil: hoy redirige a la app, después sirve el
sitio, y nunca queda en el medio.

### 1.1 Antes de tocar nada

- [ ] Los huecos `[[…]]` de `SITIO-WEB-LEGAL.md` están llenos. La prueba es que
      el job `build` de `site.yml` pase su paso «candado legal»: recorre
      `apps/site/dist` y falla si queda uno.
- [ ] El sitio construye limpio: `pnpm --filter site... build`.
- [ ] El hash del guion del tema coincide con el de la CSP de los dos vhosts:
      `infrastructure/scripts/site-csp-hash.sh`.

### 1.2 Preparar el server (todavía no cambia nada para el visitante)

```sh
ssh deploy@<DEPLOY_HOST> "mkdir -p /opt/sites/sellpointy.com/releases /opt/sellpoint/scripts"
```

`mkdir` **como `deploy`** y no dejando que lo cree Docker: `/opt/sites` es un
bind-mount de `nginx-edge`, y si el directorio lo crea el demonio queda con
owner `root` — `deploy` no tiene sudo y no podría volver a escribir ahí (R9 del
proposal vps-multidominio).

### 1.3 Publicar la primera release, con el apex todavía redirigiendo

```sh
pnpm --filter site... build
tar -czf /tmp/sitio.tgz -C apps/site/dist .
scp infrastructure/scripts/site-deploy-remote.sh deploy@<DEPLOY_HOST>:/opt/sellpoint/scripts/
scp /tmp/sitio.tgz deploy@<DEPLOY_HOST>:/tmp/sitio.tgz
ssh -n deploy@<DEPLOY_HOST> "bash /opt/sellpoint/scripts/site-deploy-remote.sh $(git rev-parse HEAD) /tmp/sitio.tgz"
```

Al terminar, `/opt/sites/sellpointy.com/public` es un enlace a la release y los
archivos ya están en disco. **Nadie los ve todavía**: el apex sigue redirigiendo
a `app.`. Esto es a propósito — cuando se cambie el vhost, el contenido ya está.

### 1.4 El commit que enciende

Un solo commit, con estas cuatro cosas juntas:

1. `git mv infrastructure/nginx/pending/sellpointy.com.conf infrastructure/nginx/conf.d/`
2. **Quitar de `conf.d/app.sellpointy.com.conf` los dos `server` del final** —
   los que están bajo el título `── El APEX: redirect 301 a la app ──`: el de
   `:80` y el de `:443`, los dos con `server_name sellpointy.com;`. Si se dejan,
   nginx arranca igual pero con dos bloques compitiendo por el mismo nombre
   (avisa «conflicting server name») y gana el primero del glob alfabético, que
   es `app.sellpointy.com.conf`: el sitio quedaría publicado y sin servir.
   **No se toca nada más de ese archivo.**
3. En `infrastructure/scripts/site-csp-hash.sh`, cambiar la ruta de
   `VHOSTS_POR_OMISION` de `pending/` a `conf.d/`.
4. En `infrastructure/scripts/site-vhost.test.sh`, mover `APEX` a `conf.d/` y
   quitar las dos comprobaciones del candado («ningún vhost de conf.d/ sirve el
   sitio todavía» y «el apex sigue redirigiendo a app»), que a partir de ahí
   dejan de ser ciertas por diseño.

El push hace el resto: `deploy.yml` copia `conf.d/`, corre `nginx -t` y recarga.
Si `nginx -t` falla, **aborta sin recargar** y la config vieja sigue sirviendo.

<details>
<summary>Variante «en caliente», sin esperar los ~18 minutos del deploy</summary>

```sh
scp infrastructure/nginx/pending/sellpointy.com.conf \
    deploy@<DEPLOY_HOST>:/opt/sellpoint/nginx/conf.d/sellpointy.com.conf
# y editar allá app.sellpointy.com.conf para quitarle los dos server del apex
ssh deploy@<DEPLOY_HOST> "cd /opt/sellpoint && docker compose -f docker-compose.prod.yml exec -T nginx-edge nginx -t"
ssh deploy@<DEPLOY_HOST> "cd /opt/sellpoint && docker compose -f docker-compose.prod.yml exec -T nginx-edge nginx -s reload"
```

⚠️ Esto dura hasta el próximo push: el pipeline reescribe `conf.d/` completo con
lo que diga el repo. El commit del paso 1.4 **no es opcional**, solo puede ir
después.

</details>

### 1.5 Verificar

```sh
ssh deploy@<DEPLOY_HOST> '
  for r in /es-mx/ /en-us/ /es-us/ /en-ca/ /fr-ca/; do
    echo -n "$r → "; curl -s -o /dev/null -w "%{http_code}\n" --resolve sellpointy.com:443:127.0.0.1 "https://sellpointy.com$r"
  done
  curl -sI --resolve sellpointy.com:443:127.0.0.1 https://sellpointy.com/es-mx/ | grep -i content-security
  curl -s -o /dev/null -w "login → %{http_code} %{redirect_url}\n" --resolve sellpointy.com:443:127.0.0.1 https://sellpointy.com/login
  curl -s -o /dev/null -w "api/auth → %{http_code}\n" --resolve sellpointy.com:443:127.0.0.1 https://sellpointy.com/api/auth/login
'
```

Esperado: cinco `200`, una CSP que empieza en `default-src 'none'`, `login → 301
https://app.sellpointy.com/login` y `api/auth → 404`.

### 1.6 Recién ahora, el pipeline

Poner la variable de repositorio **`SITE_DEPLOY_ENABLED=true`**
(Settings → Secrets and variables → Actions → Variables). Desde ese momento,
cada push que toque `apps/site/**` publica el sitio solo.

Antes de eso el job `deploy` de `site.yml` se **salta** (no falla): es lo que
permite que el pipeline exista, construya y se pruebe sin publicar nada.

### Volver atrás

```sh
ssh -n deploy@<DEPLOY_HOST> "bash /opt/sellpoint/scripts/site-deploy-remote.sh --rollback"
```

Mueve el enlace a la release anterior. Es instantáneo y no hay nada que
deshacer: no hay migraciones ni imágenes de por medio. Se conservan las tres
últimas releases.

Si lo que hay que deshacer es el **vhost**, el rollback es revertir el commit de
1.4: vuelven los dos `server` del apex y con ellos el 301 a la app.

---

## 2. Lo que se pierde al encender (leer antes, no después)

Hoy el apex redirige **todo** a `app.sellpointy.com`. Desde el encendido, el
apex sirve el sitio y **solo estas rutas** siguen viajando a la app:

```
/login  /register  /forgot-password  /reset-password  /verify-email
/verify  /accept-invitation  /onboarding  /profile  /dashboard
```

Cualquier otra dirección guardada de `sellpointy.com/…` que antes llegaba a la
app **pasa a dar 404**. La lista son los primeros segmentos de
`apps/web/src/routes`; agregar una ruta pública a la app es agregarla también al
`location ~ ^/(?:…)` del vhost.

---

## 3. `www.sellpointy.com` — pendiente del dueño

El certificado de hoy (lineage `app.sellpointy.com`, emitido el 2026-08-27)
cubre `app.sellpointy.com`, `sellpointy.com` y `sandbox.sellpointy.com`. **No
cubre `www`.** Por eso el vhost declara `www` en `:80` (para redirigir al apex y
para que certbot pueda resolver su ACME) pero **no** en `:443`: servirlo ahí
daría un error de certificado, que es peor que no servirlo.

Para arreglarlo hace falta:

1. Un registro DNS `www.sellpointy.com` apuntando al server.
2. Reemitir el **mismo lineage** agregando el SAN. Primero en seco — Let's
   Encrypt permite 5 certificados duplicados por semana y quemarlos deja el
   dominio sin poder renovar:

```sh
ssh deploy@<DEPLOY_HOST> "cd /opt/sellpoint && docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot --key-type ecdsa --register-unsafely-without-email --agree-tos -n \
  --cert-name app.sellpointy.com --dry-run \
  -d app.sellpointy.com -d sellpointy.com -d sandbox.sellpointy.com -d www.sellpointy.com"
```

3. Si el `--dry-run` pasa limpio, repetir **sin** `--dry-run`.
4. Agregar `www.sellpointy.com` al `server_name` del bloque `:443` del vhost y
   recargar.

`--cert-name app.sellpointy.com` es lo que mantiene la ruta
`/etc/letsencrypt/live/app.sellpointy.com/`: sin él, certbot crearía un lineage
nuevo y **todos** los vhosts que apuntan ahí se quedarían con el certificado
viejo.

---

## 4. El sitio en pruebas (`sitio-sandbox.sellpointy.com`)

### Por qué un nombre nuevo

`sandbox.sellpointy.com` ya es el sandbox de la **aplicación** y no se toca. El
sitio necesita el suyo.

### Qué falta (las dos cosas son del dueño)

1. **DNS**: un registro `sitio-sandbox.sellpointy.com` al server.
2. **Certificado**: agregar ese nombre como SAN del mismo lineage, con el mismo
   comando de la sección 3 sumándole `-d sitio-sandbox.sellpointy.com`.

Mientras falte el certificado, **no muevas este archivo a `conf.d/`**: nginx
arranca igual (apunta a un lineage que sí existe, justamente para no poder
abortar un deploy de producción), pero cualquier navegador vería un error de
certificado antes de ver una letra del sitio.

Después, igual que el apex: `mkdir -p /opt/sites/sitio-sandbox.sellpointy.com/releases`,
primera release con `SITE_ROOT=/opt/sites/sitio-sandbox.sellpointy.com bash site-deploy-remote.sh …`,
y recién entonces mover el vhost.

### ⚠️ Qué protección tiene hoy el sandbox — ninguna

Se leyó entero `conf.d/sandbox.sellpointy.com.conf`: **no tiene `auth_basic`, ni
`allow`/`deny` por IP, ni ningún otro control de acceso**. Está abierto a
internet y lo único que lo separa de producción son sus credenciales y su base
de datos.

El vhost del sitio en pruebas hereda exactamente esa postura, y le agrega
`X-Robots-Tag: noindex, nofollow` — que evita que Google lo indexe, **no** que
alguien entre. Si el sitio en pruebas va a llevar precios o textos que no deben
verse antes de tiempo, la protección hay que **agregarla**: lo más barato es un
`auth_basic` con un `htpasswd` en el server, dos líneas en el bloque `:443`.

---

## 5. Zonas de rate limit

Cada uno de estos dos vhosts declara su propia `limit_req_zone` **en su propio
archivo**, y no en `conf.d/02-ratelimit.conf` como las de `/auth/*`. El motivo
es el de siempre: `02-ratelimit.conf` vive en `conf.d/` y viaja a producción en
el próximo push, así que declarar allí una zona para un vhost que todavía no
existe sería encender media cosa. `limit_req_zone` es válido en el contexto
`http`, y un archivo de `conf.d/` está en ese contexto: al mover el vhost, la
zona viaja con él.

Si algún día se consolidan en `02-ratelimit.conf`, hay que **borrarlas del
vhost en el mismo commit**: dos `limit_req_zone` con el mismo nombre hacen
fallar `nginx -t`, y ese `nginx -t` corre en cada deploy de producción.
`site-vhost.test.sh` comprueba que los nombres no choquen entre sí ni con los
que ya existen.

---

## 6. Correo del dominio (F11-SITE-INFRA-05) — pendiente del dueño

Nada de esto se puede hacer desde el repo: son registros DNS y el panel de
Resend. `infrastructure/env.prod.example` ya lo tiene anotado como un gate:

> «Gate de deploy (R8): no activar resend hasta que … tenga SPF+DKIM
> verificados» — y `MAIL_FROM=no-reply@sellpointy.com` pasa a valer «con
> `sellpointy.com` verificado en Resend (SPF+DKIM)».

Lo que hay que hacer, en orden:

- [ ] **Alta del dominio en Resend**: agregar `sellpointy.com` (no `app.`) en
      Domains. Resend devuelve los registros a publicar.
- [ ] **SPF**: registro `TXT` en el apex con el `include` que dé Resend. Si ya
      existe un SPF en el dominio, **no se agrega un segundo**: se fusionan en
      uno solo — dos registros SPF invalidan los dos y el correo se va a spam.
- [ ] **DKIM**: el `CNAME` (o `TXT`) con el selector que dé Resend. Es el que
      firma; sin él, Gmail marca el correo como no autenticado.
- [ ] **DMARC**: `TXT` en `_dmarc.sellpointy.com`. Empezar en
      `v=DMARC1; p=none; rua=mailto:<buzón>` para **observar** una o dos semanas
      antes de endurecer a `p=quarantine`. Poner `p=reject` el primer día, con
      SPF/DKIM recién publicados, es la forma clásica de que dejen de llegar los
      correos de verificación de cuenta y nadie entienda por qué.
- [ ] **Esperar la verificación en Resend** (los registros tardan en propagarse;
      el panel lo marca en verde).
- [ ] **Prueba de bandeja de entrada**: mandarse un correo real del flujo de
      registro a una cuenta de **Gmail** y confirmar que (a) cae en Recibidos y
      no en Spam, y (b) en «Mostrar original» dice `SPF: PASS`, `DKIM: PASS` y
      `DMARC: PASS`. Gmail es el que hay que pasar: es donde está la mayoría de
      los clientes.
- [ ] Recién entonces, en el `.env` del server: `MAIL_FROM=no-reply@sellpointy.com`
      (en el sandbox, `MAIL_FROM=sandbox@sellpointy.com`, para que un correo de
      pruebas se note desde el asunto).

`RESEND_API_KEY` ya está en el server y la comparte `cert-expiry-check.sh`: no
hay credencial nueva que crear.
